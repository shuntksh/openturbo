import { dlopen, type Pointer, ptr } from "bun:ffi";
import type { OwnedSpawnOptions } from "./types";

const CREATE_SUSPENDED = 0x00000004;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_NEW_PROCESS_GROUP = 0x00000200;
const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
const HANDLE_FLAG_INHERIT = 0x00000001;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
const STARTF_USESTDHANDLES = 0x00000100;
const STILL_ACTIVE = 259;
const WAIT_OBJECT_0 = 0;
const GENERIC_READ = 0x80000000;
const FILE_SHARE_READ_WRITE = 0x00000003;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;

function loadApi() {
	return dlopen("kernel32.dll", {
		CloseHandle: { args: ["ptr"], returns: "bool" },
		CreatePipe: { args: ["ptr", "ptr", "ptr", "u32"], returns: "bool" },
		CreateFileW: {
			args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"],
			returns: "ptr",
		},
		CreateProcessW: {
			args: [
				"ptr",
				"ptr",
				"ptr",
				"ptr",
				"bool",
				"u32",
				"ptr",
				"ptr",
				"ptr",
				"ptr",
			],
			returns: "bool",
		},
		DeleteProcThreadAttributeList: { args: ["ptr"], returns: "void" },
		GetExitCodeProcess: { args: ["ptr", "ptr"], returns: "bool" },
		GetLastError: { args: [], returns: "u32" },
		PeekNamedPipe: {
			args: ["ptr", "ptr", "u32", "ptr", "ptr", "ptr"],
			returns: "bool",
		},
		ReadFile: {
			args: ["ptr", "ptr", "u32", "ptr", "ptr"],
			returns: "bool",
		},
		InitializeProcThreadAttributeList: {
			args: ["ptr", "u32", "u32", "ptr"],
			returns: "bool",
		},
		ResumeThread: { args: ["ptr"], returns: "u32" },
		SetHandleInformation: {
			args: ["ptr", "u32", "u32"],
			returns: "bool",
		},
		TerminateProcess: { args: ["ptr", "u32"], returns: "bool" },
		WaitForSingleObject: { args: ["ptr", "u32"], returns: "u32" },
		UpdateProcThreadAttribute: {
			args: ["ptr", "u32", "u64", "ptr", "u64", "ptr", "ptr"],
			returns: "bool",
		},
	});
}

type NativeApi = ReturnType<typeof loadApi>;
let nativeApi: NativeApi | undefined;

function api(): NativeApi {
	if (nativeApi === undefined) nativeApi = loadApi();
	return nativeApi;
}

function wide(value: string): Uint16Array {
	const result = new Uint16Array(value.length + 1);
	for (let index = 0; index < value.length; index++) {
		result[index] = value.charCodeAt(index);
	}
	return result;
}

function quoteArg(value: string): string {
	if (value.length > 0 && !/[\s"]/u.test(value)) return value;
	let result = '"';
	let slashes = 0;
	for (const char of value) {
		if (char === "\\") {
			slashes++;
		} else if (char === '"') {
			result += `${"\\".repeat(slashes * 2 + 1)}"`;
			slashes = 0;
		} else {
			result += "\\".repeat(slashes) + char;
			slashes = 0;
		}
	}
	return `${result}${"\\".repeat(slashes * 2)}"`;
}

function environmentBlock(
	env: Record<string, string | undefined>,
): Uint16Array {
	const text = Object.entries(env)
		.filter((entry): entry is [string, string] => entry[1] !== undefined)
		.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
		.map(([key, value]) => `${key}=${value}\0`)
		.join("");
	return wide(`${text}\0`);
}

function handleSlot(): BigUint64Array {
	return new BigUint64Array(1);
}

function pointerFromSlot(slot: BigUint64Array): Pointer {
	return Number(slot[0]) as Pointer;
}

function closeHandle(handle: Pointer | null): void {
	if (handle !== null) api().symbols.CloseHandle(handle);
}

function pointerValue(handle: Pointer): number {
	return handle as number;
}

function pipeStream(handle: Pointer): ReadableStream<Uint8Array> {
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		closeHandle(handle);
	};
	return new ReadableStream<Uint8Array>({
		cancel: close,
		pull: async (controller) => {
			const available = new Uint32Array(1);
			while (!closed) {
				if (
					!api().symbols.PeekNamedPipe(
						handle,
						null,
						0,
						null,
						ptr(available),
						null,
					)
				) {
					close();
					controller.close();
					return;
				}
				const length = Math.min(available[0] ?? 0, 64 * 1024);
				if (length > 0) {
					const chunk = new Uint8Array(length);
					const bytesRead = new Uint32Array(1);
					if (
						!api().symbols.ReadFile(
							handle,
							ptr(chunk),
							length,
							ptr(bytesRead),
							null,
						)
					) {
						close();
						controller.close();
						return;
					}
					controller.enqueue(chunk.subarray(0, bytesRead[0]));
					return;
				}
				await Bun.sleep(2);
			}
		},
	});
}

export type SuspendedWindowsProcess = {
	readonly exited: Promise<number>;
	readonly pid: number;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly stdout: ReadableStream<Uint8Array>;
	resume(): void;
	terminate(): void;
};

export function createSuspendedWindowsProcess(
	command: readonly string[],
	options: OwnedSpawnOptions,
	envMarker: Record<string, string>,
): SuspendedWindowsProcess {
	if (command.length === 0) throw new Error("Cannot spawn an empty command");
	const kernel = api();
	const security = new Uint8Array(24);
	const securityView = new DataView(security.buffer);
	securityView.setUint32(0, security.byteLength, true);
	securityView.setUint32(16, 1, true);

	const stdoutReadSlot = handleSlot();
	const stdoutWriteSlot = handleSlot();
	const stderrReadSlot = handleSlot();
	const stderrWriteSlot = handleSlot();
	if (
		!kernel.symbols.CreatePipe(
			ptr(stdoutReadSlot),
			ptr(stdoutWriteSlot),
			ptr(security),
			0,
		) ||
		!kernel.symbols.CreatePipe(
			ptr(stderrReadSlot),
			ptr(stderrWriteSlot),
			ptr(security),
			0,
		)
	) {
		throw new Error(
			`CreatePipe failed with Windows error ${kernel.symbols.GetLastError()}`,
		);
	}
	const stdoutRead = pointerFromSlot(stdoutReadSlot);
	const stdoutWrite = pointerFromSlot(stdoutWriteSlot);
	const stderrRead = pointerFromSlot(stderrReadSlot);
	const stderrWrite = pointerFromSlot(stderrWriteSlot);
	const nullInput = kernel.symbols.CreateFileW(
		ptr(wide("NUL")),
		GENERIC_READ,
		FILE_SHARE_READ_WRITE,
		ptr(security),
		OPEN_EXISTING,
		FILE_ATTRIBUTE_NORMAL,
		null,
	);
	if (nullInput === null || pointerValue(nullInput) === -1) {
		throw new Error(
			`Could not open NUL with Windows error ${kernel.symbols.GetLastError()}`,
		);
	}
	if (
		!kernel.symbols.SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0) ||
		!kernel.symbols.SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0)
	) {
		throw new Error(
			`SetHandleInformation failed with Windows error ${kernel.symbols.GetLastError()}`,
		);
	}

	const attributeSize = new BigUint64Array(1);
	kernel.symbols.InitializeProcThreadAttributeList(
		null,
		1,
		0,
		ptr(attributeSize),
	);
	const attributeList = new Uint8Array(Number(attributeSize[0]));
	if (
		!kernel.symbols.InitializeProcThreadAttributeList(
			ptr(attributeList),
			1,
			0,
			ptr(attributeSize),
		)
	) {
		throw new Error("InitializeProcThreadAttributeList failed");
	}
	const inheritedHandles = new BigUint64Array([
		BigInt(pointerValue(nullInput)),
		BigInt(pointerValue(stdoutWrite)),
		BigInt(pointerValue(stderrWrite)),
	]);
	if (
		!kernel.symbols.UpdateProcThreadAttribute(
			ptr(attributeList),
			0,
			PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
			ptr(inheritedHandles),
			BigInt(inheritedHandles.byteLength),
			null,
			null,
		)
	) {
		throw new Error("UpdateProcThreadAttribute failed");
	}

	const startup = new Uint8Array(112);
	const startupView = new DataView(startup.buffer);
	startupView.setUint32(0, startup.byteLength, true);
	startupView.setUint32(60, STARTF_USESTDHANDLES, true);
	startupView.setBigUint64(80, BigInt(pointerValue(nullInput)), true);
	startupView.setBigUint64(88, BigInt(pointerValue(stdoutWrite)), true);
	startupView.setBigUint64(96, BigInt(pointerValue(stderrWrite)), true);
	startupView.setBigUint64(104, BigInt(pointerValue(ptr(attributeList))), true);
	const processInfo = new Uint8Array(24);
	const commandLine = wide(
		options.windowsVerbatimArguments
			? [quoteArg(command[0] ?? ""), ...command.slice(1)].join(" ")
			: command.map(quoteArg).join(" "),
	);
	const cwd = options.cwd ? wide(options.cwd) : null;
	const env = environmentBlock({
		...process.env,
		...options.env,
		...envMarker,
	});

	let created = false;
	try {
		created = kernel.symbols.CreateProcessW(
			null,
			ptr(commandLine),
			null,
			null,
			true,
			CREATE_SUSPENDED |
				CREATE_UNICODE_ENVIRONMENT |
				CREATE_NEW_PROCESS_GROUP |
				EXTENDED_STARTUPINFO_PRESENT,
			ptr(env),
			cwd ? ptr(cwd) : null,
			ptr(startup),
			ptr(processInfo),
		);
	} finally {
		kernel.symbols.DeleteProcThreadAttributeList(ptr(attributeList));
		closeHandle(stdoutWrite);
		closeHandle(stderrWrite);
		closeHandle(nullInput);
	}
	if (!created) {
		closeHandle(stdoutRead);
		closeHandle(stderrRead);
		throw new Error(
			`CreateProcessW failed with Windows error ${kernel.symbols.GetLastError()}`,
		);
	}

	const info = new DataView(processInfo.buffer);
	const processHandle = Number(info.getBigUint64(0, true)) as Pointer;
	const threadHandle = Number(info.getBigUint64(8, true)) as Pointer;
	const pid = info.getUint32(16, true);
	let resumed = false;
	let terminated = false;
	const exited = (async () => {
		const exitCode = new Uint32Array(1);
		while (true) {
			if (
				kernel.symbols.WaitForSingleObject(processHandle, 0) === WAIT_OBJECT_0
			) {
				if (!kernel.symbols.GetExitCodeProcess(processHandle, ptr(exitCode))) {
					throw new Error("GetExitCodeProcess failed");
				}
				return exitCode[0] === STILL_ACTIVE ? 1 : (exitCode[0] ?? 1);
			}
			await Bun.sleep(10);
		}
	})().finally(() => {
		closeHandle(threadHandle);
		closeHandle(processHandle);
	});

	return {
		exited,
		pid,
		stderr: pipeStream(stderrRead),
		stdout: pipeStream(stdoutRead),
		resume: () => {
			if (resumed || terminated) return;
			if (kernel.symbols.ResumeThread(threadHandle) === 0xffffffff) {
				throw new Error("ResumeThread failed");
			}
			resumed = true;
		},
		terminate: () => {
			if (terminated) return;
			terminated = true;
			kernel.symbols.TerminateProcess(processHandle, 1);
		},
	};
}
