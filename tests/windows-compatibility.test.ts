import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { runCmdAction } from "../src/actions/cmd";
import { WorktreeManager } from "../src/git/worktree";
import { resolveShell } from "../src/shell";
import type { Config } from "../src/types";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("Windows shell compatibility and security", () => {
	const originalShell = process.env.OT_SHELL;
	let tempRoot = "";

	beforeEach(() => {
		tempRoot = realpathSync(mkdtempSync(join(tmpdir(), "ot-windows-")));
	});

	afterEach(() => {
		delete process.env.OT_WINDOWS_INJECTION_SENTINEL;
		if (originalShell === undefined) delete process.env.OT_SHELL;
		else process.env.OT_SHELL = originalShell;
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	for (const shell of ["pwsh", "cmd"] as const) {
		test(`${shell} preserves hostile-looking changed-file arguments`, async () => {
			process.env.OT_SHELL = shell;
			process.env.OT_WINDOWS_INJECTION_SENTINEL = "EXPANDED";
			const files = [
				"space name.ts",
				"single'quote.ts",
				"unicode-雪-🚀.ts",
				"$env:OT_WINDOWS_INJECTION_SENTINEL",
				"`Write-Output injected`",
				"semi;Write-Output injected",
				"amp&whoami",
				"percent-%OT_WINDOWS_INJECTION_SENTINEL%.ts",
				"bang-!OT_WINDOWS_INJECTION_SENTINEL!.ts",
				"caret^name.ts",
				...(shell === "pwsh" ? ["pipe|whoami", 'quote-"&whoami".ts'] : []),
			];
			const result = await runCmdAction(
				`bun -e "console.log(JSON.stringify(process.argv.slice(1)))"`,
				{
					appendChangedFiles: true,
					changedFiles: files,
					changedFilesSpecified: true,
					verbose: false,
				},
			);

			expect({ success: result.success, output: result.output }).toMatchObject({
				success: true,
			});
			expect(JSON.parse(result.output.trim())).toEqual(files);
			expect(result.output).not.toContain("EXPANDED");
		});
	}

	test("cmd rejects forbidden filename characters before shell parsing", async () => {
		process.env.OT_SHELL = "cmd";
		const marker = join(process.cwd(), "ot-windows-injection-marker.tmp");
		if (existsSync(marker)) rmSync(marker);
		try {
			const result = await runCmdAction("bun -e \"console.log('safe')\"", {
				appendChangedFiles: true,
				changedFiles: ['bad" & echo injected>ot-windows-injection-marker.tmp & rem "'],
				changedFilesSpecified: true,
				verbose: false,
			});
			expect(result.success).toBe(false);
			expect(result.output).toContain("forbidden in Windows filenames");
			expect(existsSync(marker)).toBe(false);
		} finally {
			if (existsSync(marker)) rmSync(marker);
		}
	});

	test("auto detection selects native PowerShell on Windows", () => {
		delete process.env.OT_SHELL;
		const shell = resolveShell("win32", process.env);
		expect(shell.kind).toBe("powershell");
		expect(shell.executable.toLowerCase()).toMatch(/powershell|pwsh/);
	});

	test("PowerShell preserves ANSI escape bytes from child commands", async () => {
		process.env.OT_SHELL = "pwsh";
		const result = await runCmdAction(
			`bun -e "process.stdout.write(String.fromCharCode(27) + '[31mred' + String.fromCharCode(27) + '[0m')"`,
			{ verbose: false },
		);
		expect(result.success).toBe(true);
		expect(result.output).toBe("\x1b[31mred\x1b[0m");
	});

	test("failed shell scripts include an actionable POSIX-shell hint", async () => {
		process.env.OT_SHELL = "pwsh";
		const result = await runCmdAction("./missing-script.sh", { verbose: false });
		expect(result.success).toBe(false);
		expect(result.output).toContain("POSIX shell");
		expect(result.output).toContain("OT_SHELL=sh");
	});

	test("rejects unsupported shell overrides without spawning", () => {
		expect(() => resolveShell("win32", { OT_SHELL: "calc.exe" })).toThrow(
			/Unsupported OT_SHELL value/,
		);
	});

	test("worktree copy blocks Windows traversal and sibling-prefix attacks", async () => {
		const gitRoot = join(tempRoot, "repo");
		const sibling = join(tempRoot, "repo-evil");
		mkdirSync(gitRoot);
		mkdirSync(sibling);
		writeFileSync(join(gitRoot, "safe.txt"), "safe");
		writeFileSync(join(sibling, "secret.txt"), "secret");
		await $`git init -q`.cwd(gitRoot);
		await $`git config user.email "windows-test@example.com"`.cwd(gitRoot);
		await $`git config user.name "Windows Test"`.cwd(gitRoot);
		await $`git add safe.txt`.cwd(gitRoot);
		await $`git commit -m init -q`.cwd(gitRoot);

		const manager = new WorktreeManager(gitRoot, {
			workflows: {},
		} satisfies Config);
		const outside = join(tempRoot, "outside.txt");

		for (const source of [
			"..\\repo-evil\\secret.txt",
			"../repo-evil/secret.txt",
			"..\\..\\outside.txt",
			resolve(sibling, "secret.txt"),
		]) {
			await expect(manager.copy(source, "stolen.txt", gitRoot)).rejects.toThrow(
				/Path traversal detected/,
			);
		}
		await expect(manager.copy("safe.txt", "..\\outside.txt", gitRoot)).rejects.toThrow(
			/Path traversal detected/,
		);
		expect(existsSync(outside)).toBe(false);
		expect(readFileSync(join(sibling, "secret.txt"), "utf8")).toBe("secret");
	});
});
