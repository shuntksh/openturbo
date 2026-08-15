import { dlopen, type Pointer, ptr } from "bun:ffi";
import type { OwnedProcess, OwnedSpawnOptions, ProcessOwner } from "./types";
import { createSuspendedWindowsProcess } from "./windows-native";

const OWNER_MARKER = "OT_PROCESS_OWNER_WINDOWS_JOB";
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const CLEANUP_TIMEOUT_MS = 5000;
const CTRL_BREAK_EVENT = 1;

type JobState = "empty" | "running" | "stopping" | "closed";
type LaunchState =
	| "no-child"
	| "gated-unassigned"
	| "gated-assigned"
	| "running"
	| "stopping"
	| "exited";

function loadWindowsApi() {
	return dlopen("kernel32.dll", {
		AssignProcessToJobObject: {
			args: ["ptr", "ptr"],
			returns: "bool",
		},
		CloseHandle: { args: ["ptr"], returns: "bool" },
		CreateJobObjectW: {
			args: ["ptr", "ptr"],
			returns: "ptr",
		},
		GetLastError: { args: [], returns: "u32" },
		GenerateConsoleCtrlEvent: {
			args: ["u32", "u32"],
			returns: "bool",
		},
		OpenProcess: {
			args: ["u32", "bool", "u32"],
			returns: "ptr",
		},
		QueryInformationJobObject: {
			args: ["ptr", "i32", "ptr", "u32", "ptr"],
			returns: "bool",
		},
		SetInformationJobObject: {
			args: ["ptr", "i32", "ptr", "u32"],
			returns: "bool",
		},
		TerminateJobObject: {
			args: ["ptr", "u32"],
			returns: "bool",
		},
	});
}

type WindowsApi = ReturnType<typeof loadWindowsApi>;
let windowsApi: WindowsApi | undefined;

function getWindowsApi(): WindowsApi {
	if (windowsApi === undefined) windowsApi = loadWindowsApi();
	return windowsApi;
}

function windowsError(api: WindowsApi, operation: string): Error {
	return new Error(
		`${operation} failed with Windows error ${api.symbols.GetLastError()}`,
	);
}

class WindowsJob {
	private readonly api = getWindowsApi();
	private readonly handle: Pointer;
	private state: JobState = "empty";
	private stopPromise: Promise<void> | undefined;

	constructor(private readonly label: string) {
		const handle = this.api.symbols.CreateJobObjectW(null, null);
		if (handle === null) throw windowsError(this.api, "CreateJobObjectW");
		this.handle = handle;

		try {
			// JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes on Windows x64.
			const limits = new Uint8Array(144);
			new DataView(limits.buffer).setUint32(
				16,
				JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
				true,
			);
			if (
				!this.api.symbols.SetInformationJobObject(
					this.handle,
					JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
					ptr(limits),
					limits.byteLength,
				)
			) {
				throw windowsError(this.api, "SetInformationJobObject");
			}
		} catch (error) {
			this.close();
			throw error;
		}
	}

	assign(pid: number): void {
		if (this.state === "stopping" || this.state === "closed") {
			throw new Error(
				`Cannot assign a process to ${this.label}: job is ${this.state}`,
			);
		}
		const processHandle = this.api.symbols.OpenProcess(
			PROCESS_TERMINATE | PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION,
			false,
			pid,
		);
		if (processHandle === null) throw windowsError(this.api, "OpenProcess");
		try {
			if (
				!this.api.symbols.AssignProcessToJobObject(this.handle, processHandle)
			) {
				throw windowsError(this.api, "AssignProcessToJobObject");
			}
			this.state = "running";
		} finally {
			this.api.symbols.CloseHandle(processHandle);
		}
	}

	private activeProcesses(): number {
		const accounting = new Uint8Array(48);
		if (
			!this.api.symbols.QueryInformationJobObject(
				this.handle,
				JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
				ptr(accounting),
				accounting.byteLength,
				null,
			)
		) {
			throw windowsError(this.api, "QueryInformationJobObject");
		}
		return new DataView(accounting.buffer).getUint32(40, true);
	}

	stop(): Promise<void> {
		if (this.stopPromise !== undefined) return this.stopPromise;
		this.stopPromise = this.stopOnce();
		return this.stopPromise;
	}

	private async stopOnce(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "stopping";
		let cleanupError: Error | undefined;
		try {
			if (!this.api.symbols.TerminateJobObject(this.handle, 1)) {
				const active = this.activeProcesses();
				if (active > 0) {
					cleanupError = windowsError(this.api, "TerminateJobObject");
				}
			}

			const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
			while (this.activeProcesses() > 0 && Date.now() < deadline) {
				await Bun.sleep(10);
			}
			const remaining = this.activeProcesses();
			if (remaining > 0) {
				cleanupError = new Error(
					`${this.label} cleanup timed out with ${remaining} active process(es)`,
				);
			}
		} catch (error) {
			cleanupError = error instanceof Error ? error : new Error(String(error));
		} finally {
			this.close();
		}
		if (cleanupError) throw cleanupError;
	}

	private close(): void {
		if (this.state === "closed") return;
		this.api.symbols.CloseHandle(this.handle);
		this.state = "closed";
	}
}

type ActiveTask = {
	readonly job: WindowsJob;
	requestGracefulStop(): void;
	stop(): Promise<void>;
};

export type WindowsOwnerTestHooks = {
	readonly beforeAssign?: () => void;
};

export class WindowsProcessOwner implements ProcessOwner {
	readonly kind = "windows" as const;
	private readonly inherited = process.env[OWNER_MARKER] === "1";
	private readonly rootJob = this.inherited
		? undefined
		: new WindowsJob("workflow Job Object");
	private readonly tasks = new Set<ActiveTask>();
	private stopping = false;

	constructor(private readonly testHooks: WindowsOwnerTestHooks = {}) {}

	async spawn(
		command: readonly string[],
		options: OwnedSpawnOptions = {},
	): Promise<OwnedProcess> {
		if (this.stopping) throw new Error("Windows process owner is stopping");
		if (this.inherited) return this.spawnInherited(command, options);

		let state: LaunchState = "no-child";
		const taskJob = new WindowsJob(
			`command Job Object (${command[0] ?? "unknown"})`,
		);
		const proc = createSuspendedWindowsProcess(command, options, {
			[OWNER_MARKER]: "1",
		});
		state = "gated-unassigned";

		try {
			this.testHooks.beforeAssign?.();
			this.rootJob?.assign(proc.pid);
			taskJob.assign(proc.pid);
			state = "gated-assigned";
			proc.resume();
		} catch (error) {
			const failureState = state;
			state = "stopping";
			proc.terminate();
			await proc.exited.catch(() => undefined);
			await Promise.allSettled([proc.stdout.cancel(), proc.stderr.cancel()]);
			await taskJob.stop().catch(() => undefined);
			state = "exited";
			throw new Error(
				`Windows containment failed closed during ${failureState}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		let stopPromise: Promise<void> | undefined;
		const task: ActiveTask = {
			job: taskJob,
			requestGracefulStop: () => {
				// The gated host is created as a new console process group. CTRL_BREAK is
				// the Windows console-control request that can target that group.
				getWindowsApi().symbols.GenerateConsoleCtrlEvent(
					CTRL_BREAK_EVENT,
					proc.pid,
				);
			},
			stop: () => {
				if (stopPromise !== undefined) return stopPromise;
				state = "stopping";
				stopPromise = taskJob.stop().finally(() => {
					state = "exited";
					this.tasks.delete(task);
				});
				return stopPromise;
			},
		};
		this.tasks.add(task);
		state = "running";

		return {
			exited: proc.exited.then(async (exitCode) => {
				await task.stop();
				return exitCode;
			}),
			stderr: proc.stderr,
			stdout: proc.stdout,
			terminate: () => {
				void task.stop();
			},
		};
	}

	private async spawnInherited(
		command: readonly string[],
		options: OwnedSpawnOptions,
	): Promise<OwnedProcess> {
		const proc = Bun.spawn([...command], {
			cwd: options.cwd,
			env: { ...process.env, ...options.env, [OWNER_MARKER]: "1" },
			stderr: "pipe",
			stdin: "ignore",
			stdout: "pipe",
			windowsVerbatimArguments: options.windowsVerbatimArguments,
		});
		return {
			exited: proc.exited,
			stderr: proc.stderr,
			stdout: proc.stdout,
			terminate: () => {
				try {
					proc.kill("SIGKILL");
				} catch {}
			},
		};
	}

	async shutdown(options: { readonly graceful?: boolean } = {}): Promise<void> {
		if (this.stopping) return;
		this.stopping = true;
		if (this.inherited) return;
		if (options.graceful && this.tasks.size > 0) {
			for (const task of this.tasks) task.requestGracefulStop();
			await Bun.sleep(250);
		}

		const failures = (
			await Promise.allSettled([...this.tasks].map((task) => task.stop()))
		).filter((result) => result.status === "rejected");
		try {
			await this.rootJob?.stop();
		} catch (error) {
			failures.push({ status: "rejected", reason: error });
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures.map((failure) => failure.reason),
				"Windows process cleanup failed",
			);
		}
	}
}
