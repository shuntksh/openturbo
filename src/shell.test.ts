import { describe, expect, test } from "bun:test";
import {
	buildShellCommand,
	quoteShellArgument,
	shellScriptHint,
} from "./shell";

describe("shell compatibility", () => {
	test("uses native PowerShell invocation", () => {
		expect(
			buildShellCommand(
				{ executable: "pwsh.exe", kind: "powershell" },
				"Write-Output 'ok'",
			),
		).toEqual([
			"pwsh.exe",
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Write-Output 'ok'",
		]);
	});

	test("quotes apostrophes for each shell dialect", () => {
		expect(quoteShellArgument("it's here", "powershell")).toBe("'it''s here'");
		expect(quoteShellArgument("it's here", "posix")).toBe("'it'\\''s here'");
		expect(quoteShellArgument("with space", "cmd")).toBe('"with space"');
	});

	test("explains how to run POSIX shell scripts", () => {
		const hint = shellScriptHint("./check.sh", {
			executable: "pwsh.exe",
			kind: "powershell",
		});
		expect(hint).toContain("OT_SHELL=sh");
		expect(
			shellScriptHint("Write-Output ok", {
				executable: "pwsh.exe",
				kind: "powershell",
			}),
		).toBe("");
	});
});
