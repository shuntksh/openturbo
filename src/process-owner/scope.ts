import { AsyncLocalStorage } from "node:async_hooks";
import { PosixProcessOwner } from "./posix";
import type { OwnedProcess, OwnedSpawnOptions, ProcessOwner } from "./types";
import { WindowsProcessOwner } from "./windows";

const ownerStorage = new AsyncLocalStorage<ProcessOwner>();
const activeOwners = new Set<ProcessOwner>();
let handlersInstalled = false;
let shutdownPromise: Promise<void> | undefined;

function createOwner(): ProcessOwner {
	if (process.platform === "win32") return new WindowsProcessOwner();
	if (process.platform === "darwin" || process.platform === "linux") {
		return new PosixProcessOwner();
	}
	throw new Error(
		`Unsupported process ownership platform: ${process.platform}`,
	);
}

async function shutdownActiveOwners(graceful: boolean): Promise<void> {
	if (shutdownPromise !== undefined) return shutdownPromise;
	shutdownPromise = Promise.allSettled(
		[...activeOwners].map((owner) => owner.shutdown({ graceful })),
	).then((results) => {
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length > 0) {
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				"Process-owner shutdown failed",
			);
		}
	});
	return shutdownPromise;
}

function installExitHandlers(): void {
	if (handlersInstalled) return;
	handlersInstalled = true;

	process.once("exit", () => {
		// Windows KILL_ON_JOB_CLOSE is the crash safety net. Calling shutdown also
		// synchronously initiates native termination before this process disappears.
		void shutdownActiveOwners(false);
	});
	for (const [signal, exitCode] of [
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const) {
		process.once(signal, () => {
			// These events notify the supervisor only. Each backend performs its own
			// platform-native containment shutdown; Windows is not signalled as POSIX.
			void shutdownActiveOwners(true).finally(() => process.exit(exitCode));
		});
	}
}

export async function withProcessOwner<T>(
	operation: () => Promise<T>,
): Promise<T> {
	const inherited = ownerStorage.getStore();
	if (inherited !== undefined) return operation();

	installExitHandlers();
	const owner = createOwner();
	activeOwners.add(owner);
	try {
		return await ownerStorage.run(owner, operation);
	} finally {
		try {
			await owner.shutdown({ graceful: true });
		} finally {
			activeOwners.delete(owner);
		}
	}
}

export async function spawnOwned(
	command: readonly string[],
	options: OwnedSpawnOptions = {},
): Promise<OwnedProcess> {
	const scopedOwner = ownerStorage.getStore();
	if (scopedOwner !== undefined) return scopedOwner.spawn(command, options);

	installExitHandlers();
	const owner = createOwner();
	activeOwners.add(owner);
	try {
		const proc = await owner.spawn(command, options);
		return {
			...proc,
			exited: proc.exited.finally(async () => {
				try {
					await owner.shutdown({ graceful: true });
				} finally {
					activeOwners.delete(owner);
				}
			}),
		};
	} catch (error) {
		try {
			await owner.shutdown({ graceful: false });
		} finally {
			activeOwners.delete(owner);
		}
		throw error;
	}
}
