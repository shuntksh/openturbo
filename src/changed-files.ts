/**
 * Changed-file argument handling for hook runners such as Lefthook.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { quoteShellArgument, type ShellKind } from "./shell";

const CHANGED_FILES_REST_FLAGS = new Set(["--changed-files", "--files"]);
const CHANGED_FILE_FLAGS = new Set(["--changed-file"]);

export type ChangedFilesArgv = {
	readonly args: readonly string[];
	readonly changedFiles: readonly string[];
	readonly specified: boolean;
};

function pushFile(files: string[], value: string | undefined): void {
	if (value === undefined || value === "") return;
	files.push(value);
}

/**
 * Extract changed files from CLI argv before handing the remaining args to
 * parseArgs. `--changed-files` consumes the rest of argv so Lefthook can append
 * `{staged_files}` through `args` without repeating a flag for every file.
 */
export function extractChangedFilesArgv(
	argv: readonly string[],
): ChangedFilesArgv {
	const args: string[] = [];
	const changedFiles: string[] = [];
	let specified = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) continue;

		if (CHANGED_FILES_REST_FLAGS.has(arg)) {
			specified = true;
			const rest =
				argv[index + 1] === "--"
					? argv.slice(index + 2)
					: argv.slice(index + 1);
			for (const file of rest) {
				pushFile(changedFiles, file);
			}
			break;
		}

		const restFlag = [...CHANGED_FILES_REST_FLAGS].find((flag) =>
			arg.startsWith(`${flag}=`),
		);
		if (restFlag) {
			specified = true;
			pushFile(changedFiles, arg.slice(restFlag.length + 1));
			continue;
		}

		if (CHANGED_FILE_FLAGS.has(arg)) {
			specified = true;
			pushFile(changedFiles, argv[index + 1]);
			index += 1;
			continue;
		}

		const fileFlag = [...CHANGED_FILE_FLAGS].find((flag) =>
			arg.startsWith(`${flag}=`),
		);
		if (fileFlag) {
			specified = true;
			pushFile(changedFiles, arg.slice(fileFlag.length + 1));
			continue;
		}

		args.push(arg);
	}

	return { args, changedFiles, specified };
}

export function createChangedFilesEnv(
	changedFiles: readonly string[],
): Record<string, string> {
	return {
		OT_CHANGED_FILES: changedFiles.join("\n"),
		OT_CHANGED_FILES_COUNT: String(changedFiles.length),
		OT_CHANGED_FILES_JSON: JSON.stringify(changedFiles),
	};
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

export function normalizeChangedFiles(
	changedFiles: readonly string[],
	cwd: string,
	gitRoot: string,
): readonly string[] {
	const seen = new Set<string>();
	const normalizedFiles: string[] = [];

	for (const file of changedFiles) {
		const absolutePath = isAbsolute(file) ? file : resolve(cwd, file);
		const relativePath = toPosixPath(relative(gitRoot, absolutePath));
		if (!relativePath || seen.has(relativePath)) continue;

		seen.add(relativePath);
		normalizedFiles.push(relativePath);
	}

	return normalizedFiles;
}

export function scopeChangedFilesToDirectory(
	changedFiles: readonly string[],
	gitRoot: string,
	directory: string,
): readonly string[] {
	const directoryRelative = toPosixPath(relative(gitRoot, directory));
	const prefix = directoryRelative ? `${directoryRelative}/` : "";
	const scopedFiles: string[] = [];

	for (const file of changedFiles) {
		if (!prefix) {
			scopedFiles.push(file);
			continue;
		}

		if (file.startsWith(prefix)) {
			scopedFiles.push(file.slice(prefix.length));
		}
	}

	return scopedFiles;
}

export function shellQuote(value: string, shell: ShellKind = "posix"): string {
	return quoteShellArgument(value, shell);
}

export function appendShellArgs(
	command: string,
	args: readonly string[],
	shell: ShellKind = "posix",
): string {
	if (args.length === 0) return command;
	const quotedArgs = args.map((arg) => shellQuote(arg, shell)).join(" ");
	return `${command.trimEnd()} ${quotedArgs}`;
}
