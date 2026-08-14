/** Cross-platform shell detection, invocation, and argument quoting. */

export type ShellKind = "cmd" | "powershell" | "posix";

export type ResolvedShell = {
	readonly executable: string;
	readonly kind: ShellKind;
};

function findExecutable(...names: string[]): string | undefined {
	for (const name of names) {
		const executable = Bun.which(name);
		if (executable) return executable;
	}
	return undefined;
}

function missingShell(name: string): Error {
	return new Error(
		`Shell "${name}" was requested but is not installed or available on PATH. ` +
			"Install the shell or set OT_SHELL to pwsh, powershell, cmd, sh, or bash.",
	);
}

/**
 * Resolves the shell used by command actions and worktree command hooks.
 * OT_SHELL can force a supported shell. Windows otherwise prefers PowerShell
 * and retains cmd.exe as a compatibility fallback.
 */
export function resolveShell(
	platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): ResolvedShell {
	const requested = env.OT_SHELL?.trim().toLowerCase();
	if (requested && requested !== "auto") {
		switch (requested) {
			case "pwsh":
				return {
					executable: findExecutable("pwsh", "pwsh.exe") ?? (() => { throw missingShell("pwsh"); })(),
					kind: "powershell",
				};
			case "powershell":
				return {
					executable:
						findExecutable("powershell", "powershell.exe") ??
						(() => { throw missingShell("powershell"); })(),
					kind: "powershell",
				};
			case "cmd":
				return {
					executable: findExecutable("cmd", "cmd.exe") ?? (() => { throw missingShell("cmd"); })(),
					kind: "cmd",
				};
			case "sh":
			case "bash":
				return {
					executable: findExecutable(requested) ?? (() => { throw missingShell(requested); })(),
					kind: "posix",
				};
			default:
				throw new Error(
					`Unsupported OT_SHELL value "${env.OT_SHELL}". Use auto, pwsh, powershell, cmd, sh, or bash.`,
				);
		}
	}

	if (platform === "win32") {
		const powershell = findExecutable("pwsh", "pwsh.exe", "powershell", "powershell.exe");
		if (powershell) return { executable: powershell, kind: "powershell" };

		const cmd = findExecutable("cmd", "cmd.exe");
		if (cmd) return { executable: cmd, kind: "cmd" };
		throw missingShell("PowerShell or cmd.exe");
	}

	const sh = findExecutable("sh");
	if (!sh) throw missingShell("sh");
	return { executable: sh, kind: "posix" };
}

export function buildShellCommand(
	shell: ResolvedShell,
	command: string,
): string[] {
	switch (shell.kind) {
		case "powershell":
			return [
				shell.executable,
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				command,
			];
		case "cmd":
			return [shell.executable, "/d", "/v:off", "/c", command];
		case "posix":
			return [shell.executable, "-c", command];
	}
}

export function quoteShellArgument(value: string, kind: ShellKind): string {
	if (value.length > 0 && /^[A-Za-z0-9_./:@+=,-]+$/.test(value)) return value;

	if (kind === "powershell") return `'${value.replace(/'/g, "''")}'`;
	if (kind === "cmd") {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function shellScriptHint(command: string, shell: ResolvedShell): string {
	if (shell.kind === "posix") return "";
	if (!/(^|\s)(?:\.[\\/])?[^\s"']+\.sh(?:\s|$)|(^|\s)(?:sh|bash)(?:\s|$)/i.test(command)) {
		return "";
	}
	return (
		"\nThis command appears to require a POSIX shell. Install Git Bash or another " +
		"POSIX shell and set OT_SHELL=sh (or OT_SHELL=bash)."
	);
}
