export type OwnedSpawnOptions = {
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	readonly windowsVerbatimArguments?: boolean;
};

export type OwnedProcess = {
	readonly exited: Promise<number>;
	readonly stderr: ReadableStream<Uint8Array>;
	readonly stdout: ReadableStream<Uint8Array>;
	terminate: () => void;
};

export interface ProcessOwner {
	readonly kind: "posix" | "windows";
	shutdown(options?: { readonly graceful?: boolean }): Promise<void>;
	spawn(
		command: readonly string[],
		options?: OwnedSpawnOptions,
	): Promise<OwnedProcess>;
}
