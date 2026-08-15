import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsProcessOwner } from "../src/process-owner/windows";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

windowsDescribe("Windows process owner lifecycle", () => {
	test("assignment rejection terminates and releases the gated host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ot-owner-rejection-"));
		const copiedHost = join(dir, "contained-host.exe");
		const marker = join(dir, "user-code-ran.txt");
		copyFileSync(Bun.which("bun") ?? process.execPath, copiedHost);

		const owner = new WindowsProcessOwner({
			beforeAssign: () => {
				throw new Error("simulated assignment rejection");
			},
		});
		try {
			await expect(
				owner.spawn([
					copiedHost,
					"-e",
					`await Bun.write(${JSON.stringify(marker)}, "ran")`,
				]),
			).rejects.toThrow(/failed closed.*gated-unassigned/);
			expect(existsSync(marker)).toBe(false);
			await owner.shutdown();

			// Deletion proves no process or leaked executable handle remains.
			rmSync(copiedHost);
			expect(existsSync(copiedHost)).toBe(false);
		} finally {
			await owner.shutdown().catch(() => undefined);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an inherited nested owner does not attempt another Job assignment", async () => {
		const original = process.env.OT_PROCESS_OWNER_WINDOWS_JOB;
		process.env.OT_PROCESS_OWNER_WINDOWS_JOB = "1";
		let assignments = 0;
		try {
			const owner = new WindowsProcessOwner({
				beforeAssign: () => {
					assignments++;
				},
			});
			const proc = await owner.spawn(["bun", "-e", "process.exit(0)"]);
			expect(await proc.exited).toBe(0);
			await owner.shutdown();
			expect(assignments).toBe(0);
		} finally {
			if (original === undefined)
				delete process.env.OT_PROCESS_OWNER_WINDOWS_JOB;
			else process.env.OT_PROCESS_OWNER_WINDOWS_JOB = original;
		}
	});
});
