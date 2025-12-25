#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { join } = require("node:path");

const platformMap = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
};

const platform = platformMap[process.platform];
const arch = process.arch;

if (!platform) {
	console.error(`Unsupported platform: ${process.platform}`);
	process.exit(1);
}

// Map Node's process.arch to Bun's arch naming if needed
// Bun uses 'x64' and 'arm64', which matches Node's 'x64' and 'arm64' for the most part.
// We might need to handle 'ia32' or others if we supported them, but for now we stick to what build.ts supports.

const binaryName = `openturbo-${platform}-${arch}`;
const binaryPath = join(__dirname, "..", "dist", binaryName);

// Forward all arguments to the binary
const args = process.argv.slice(2);

const child = spawn(binaryPath, args, {
	stdio: "inherit",
});

child.on("exit", (code) => {
	process.exit(code ?? 0);
});

child.on("error", (err) => {
	if (err.code === "ENOENT") {
		console.error(
			`Error: Could not find binary for platform ${platform}-${arch} at ${binaryPath}`,
		);
		console.error("Please ensure you have installed the package correctly.");
	} else {
		console.error("Error executing binary:", err);
	}
	process.exit(1);
});
