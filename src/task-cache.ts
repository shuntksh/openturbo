/**
 * Content-hash cache for workspace package script invocations.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { TaskNode } from "./npm-workspace";
import { runProcessTree } from "./process-tree";
import type { BunAction, BunCache } from "./types";

const CACHE_VERSION = 1;
const CACHE_DIR = ".ot/cache/v1";

const DEFAULT_GLOBAL_INPUTS = [
	"package.json",
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"workflows.json",
	"workflows.jsonc",
	".config/workflows.json",
	".config/workflows.jsonc",
	"biome.json",
	"biome.jsonc",
	"tsconfig.json",
	"eslint.config.*",
	"prettier.config.*",
	".prettierrc*",
	"vitest.config.*",
	"jest.config.*",
];

export type NormalizedBunCache = {
	readonly enabled: boolean;
	readonly inputs: readonly string[] | undefined;
	readonly globalInputs: readonly string[];
};

export type TaskCacheLookup = {
	readonly hit: boolean;
	readonly key: string;
	readonly path: string;
	readonly inputCount: number;
};

export type TaskCacheKeyOptions = {
	readonly action: BunAction;
	readonly appendChangedFiles: boolean;
	readonly changedFiles: readonly string[];
	readonly gitRoot: string;
	readonly node: TaskNode;
	readonly scriptCommand: string;
};

type TaskCacheEntry = {
	readonly version: number;
	readonly key: string;
	readonly packageName: string;
	readonly script: string;
	readonly createdAt: string;
	readonly inputCount: number;
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

export function normalizeBunCache(
	cache: BunCache | undefined,
): NormalizedBunCache {
	if (cache === undefined || cache === false) {
		return {
			enabled: false,
			inputs: undefined,
			globalInputs: DEFAULT_GLOBAL_INPUTS,
		};
	}

	if (cache === true) {
		return {
			enabled: true,
			inputs: undefined,
			globalInputs: DEFAULT_GLOBAL_INPUTS,
		};
	}

	return {
		enabled: cache.enabled ?? true,
		inputs: cache.inputs,
		globalInputs: [...DEFAULT_GLOBAL_INPUTS, ...(cache.globalInputs ?? [])],
	};
}

function matchesPatterns(path: string, patterns: readonly string[]): boolean {
	const includes = patterns.filter((pattern) => !pattern.startsWith("!"));
	const excludes = patterns
		.filter((pattern) => pattern.startsWith("!"))
		.map((pattern) => pattern.slice(1));

	const included =
		includes.length === 0 ||
		includes.some((pattern) => new Bun.Glob(pattern).match(path));
	const excluded = excludes.some((pattern) =>
		new Bun.Glob(pattern).match(path),
	);

	return included && !excluded;
}

async function collectGitFiles(
	gitRoot: string,
	pathspec: string | undefined,
): Promise<readonly string[]> {
	const args = [
		"git",
		"ls-files",
		"-z",
		"--cached",
		"--modified",
		"--others",
		"--exclude-standard",
	];
	if (pathspec && pathspec !== ".") args.push("--", pathspec);
	const result = await runProcessTree(args, { cwd: gitRoot });

	if (result.exitCode !== 0) {
		return [];
	}

	return [
		...new Set(result.stdout.split("\0").filter(Boolean).map(toPosixPath)),
	].sort();
}

async function collectPackageInputs(
	gitRoot: string,
	node: TaskNode,
	cache: NormalizedBunCache,
): Promise<readonly string[]> {
	const packageRelative = toPosixPath(relative(gitRoot, node.packagePath));
	const packageFiles = await collectGitFiles(gitRoot, packageRelative);

	if (!cache.inputs) {
		return packageFiles;
	}

	const prefix = packageRelative ? `${packageRelative}/` : "";
	return packageFiles.filter((file) => {
		const packageLocalPath = prefix ? file.slice(prefix.length) : file;
		return matchesPatterns(packageLocalPath, cache.inputs ?? []);
	});
}

async function collectGlobalInputs(
	gitRoot: string,
	cache: NormalizedBunCache,
): Promise<readonly string[]> {
	const hasGlob = cache.globalInputs.some((input) => /[*?[\]{}]/.test(input));
	if (hasGlob) {
		const allFiles = await collectGitFiles(gitRoot, undefined);
		return allFiles.filter((file) => matchesPatterns(file, cache.globalInputs));
	}

	return cache.globalInputs
		.filter((file) => existsSync(join(gitRoot, file)))
		.map(toPosixPath)
		.sort();
}

async function hashFile(
	hash: ReturnType<typeof createHash>,
	gitRoot: string,
	path: string,
): Promise<void> {
	hash.update("file\0");
	hash.update(path);
	hash.update("\0");

	const file = Bun.file(join(gitRoot, path));
	if (await file.exists()) {
		hash.update(Buffer.from(await file.arrayBuffer()));
	} else {
		hash.update("missing");
	}
	hash.update("\0");
}

export async function checkTaskCache(
	options: TaskCacheKeyOptions,
): Promise<TaskCacheLookup> {
	const cache = normalizeBunCache(options.action.cache);
	const packageInputs = await collectPackageInputs(
		options.gitRoot,
		options.node,
		cache,
	);
	const globalInputs = await collectGlobalInputs(options.gitRoot, cache);
	const inputFiles = [...new Set([...packageInputs, ...globalInputs])].sort();
	const packageRelative = toPosixPath(
		relative(options.gitRoot, options.node.packagePath),
	);

	const hash = createHash("sha256");
	hash.update(
		JSON.stringify({
			version: CACHE_VERSION,
			bunVersion: Bun.version,
			packageName: options.node.packageName,
			packagePath: packageRelative,
			script: options.node.script,
			scriptCommand: options.scriptCommand,
			action: {
				dependsOn: options.action.dependsOn ?? [],
				hardTimeoutSeconds: options.action.hardTimeoutSeconds ?? null,
				timeout: options.action.timeout ?? null,
				changedFiles: options.action.changedFiles ?? null,
				appendChangedFiles: options.appendChangedFiles,
				cache,
			},
			changedFiles: options.changedFiles,
		}),
	);
	hash.update("\0");

	for (const file of inputFiles) {
		await hashFile(hash, options.gitRoot, file);
	}

	const key = hash.digest("hex");
	const path = join(options.gitRoot, CACHE_DIR, `${key}.json`);

	if (!existsSync(path)) {
		return { hit: false, key, path, inputCount: inputFiles.length };
	}

	try {
		const entry = (await Bun.file(path).json()) as TaskCacheEntry;
		return {
			hit: entry.version === CACHE_VERSION && entry.key === key,
			key,
			path,
			inputCount: inputFiles.length,
		};
	} catch {
		return { hit: false, key, path, inputCount: inputFiles.length };
	}
}

export async function writeTaskCacheSuccess(
	lookup: TaskCacheLookup,
	node: TaskNode,
): Promise<void> {
	const entry: TaskCacheEntry = {
		version: CACHE_VERSION,
		key: lookup.key,
		packageName: node.packageName,
		script: node.script,
		createdAt: new Date().toISOString(),
		inputCount: lookup.inputCount,
	};

	await mkdir(dirname(lookup.path), { recursive: true });
	await writeFile(lookup.path, `${JSON.stringify(entry, null, 2)}\n`);
}
