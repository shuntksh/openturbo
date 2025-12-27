#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { spawn } from "bun";

async function run(cmd: string[], cwd?: string): Promise<string> {
	const proc = spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const text = await new Response(proc.stdout).text();
	const err = await new Response(proc.stderr).text();
	const code = await proc.exited;

	if (code !== 0) {
		throw new Error(`Command failed: ${cmd.join(" ")}\n${err}`);
	}
	return text.trim();
}

async function main() {
	const args = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			version: { type: "string", short: "v" },
			tag: { type: "string", short: "t" },
			major: { type: "boolean" },
			minor: { type: "boolean" },
			patch: { type: "boolean" },
            help: { type: "boolean" },
		},
		allowPositionals: true,
	});

	// 1. Read package.json
	const pkgPath = "package.json";
	const pkgFile = Bun.file(pkgPath);
	const pkg = await pkgFile.json();
	const currentVersion = pkg.version;

	if (!currentVersion) {
		console.error("Error: No version found in package.json");
		process.exit(1);
	}

	console.log(`Current version: ${currentVersion}`);

	// 2. Determine new version
	let newVersion = args.values.version;

	if (!newVersion) {
		const parts = currentVersion.split(".").map(Number);
		if (parts.length !== 3 || parts.some(Number.isNaN)) {
			console.error(`Error: Current version ${currentVersion} is not valid semver (x.y.z)`);
			process.exit(1);
		}

		let [major, minor, patch] = parts;

		if (args.values.major) {
			major++;
			minor = 0;
			patch = 0;
		} else if (args.values.minor) {
			minor++;
			patch = 0;
		} else {
			// Default to patch
			patch++;
		}
		newVersion = `${major}.${minor}.${patch}`;
	}

	// 3. Validation: Ensure advancing
	const order = Bun.semver.order(newVersion, currentVersion);
	// order(a, b): 1 if a > b, -1 if a < b, 0 if equal
	if (order <= 0) {
		console.error(`Error: New version ${newVersion} must be greater than current version ${currentVersion}`);
		process.exit(1);
	}

	// 4. Determine Tag
	const tagName = args.values.tag || `v${newVersion}`;

	// 5. Validation: Check tag conflict
	try {
		await run(["git", "show-ref", "--tags", tagName]);
		// If command succeeds, tag exists
		console.error(`Error: Tag ${tagName} already exists locally.`);
		process.exit(1);
	} catch (_) {
		// Command failed, meaning tag does not exist -> Good.
	}

	// Check remote tags (optional, but good practice to fetch first? taking user request literally: "git tag command... push")
	// We'll proceed with local check.

	console.log(`\nReady to release:`);
	console.log(`  Version: ${currentVersion} -> ${newVersion}`);
	console.log(`  Tag:     ${tagName}`);
	console.log(`\nUpdating package.json...`);

	// 6. Update package.json
	pkg.version = newVersion;
	await Bun.write(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);

	// 7. Commit and Tag
	console.log("Committing and Tagging...");
	try {
        // Build binary for release is NOT required since we are source-based now.
		await run(["git", "add", "package.json"]);
		await run(["git", "commit", "-m", `chore: release ${tagName}`]);
		await run(["git", "tag", tagName]);

		console.log("Pushing to remote...");
		await run(["git", "push", "origin", "main"]); // assuming main branch
		await run(["git", "push", "--tags"]);

		console.log(`\nSuccess! Released ${tagName}`);
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error("Release failed:", error.message);
		} else {
			console.error("Release failed:", error);
		}
		// Revert package.json change?? Maybe too complex for now. User can git checkout.
		process.exit(1);
	}
}

main();
