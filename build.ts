// Define the valid Bun targets to ensure type safety
// Note: "bun-windows-arm64" is not currently supported by Bun for compilation.
type BunTarget =
	| "bun-darwin-arm64"
	| "bun-darwin-x64"
	| "bun-linux-arm64"
	| "bun-linux-x64"
	| "bun-windows-x64";

const platformMap = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
} as const;

const platform = platformMap[process.platform as keyof typeof platformMap];
const arch = process.arch;

const supportedTargets: BunTarget[] = [
	"bun-darwin-arm64",
	"bun-darwin-x64",
	"bun-linux-arm64",
	"bun-linux-x64",
	"bun-windows-x64",
];

// Check if --current flag is passed
if (process.argv.includes("--current")) {
	const current = `bun-${platform}-${arch}` as BunTarget;
	if (supportedTargets.includes(current)) {
		console.log(`Building only for current target: ${current}`);
		supportedTargets.length = 0; // Clear array
		supportedTargets.push(current);
	} else if (platform === "windows" && arch === "arm64") {
		// Windows ARM64 fallback to x64 if needed, or error.
		// For now, let's just warn and maybe fallback to x64 if that's the intent,
		// but simplistic approach:
		console.error("Current target not supported for compilation.");
		process.exit(1);
	}
}

// Verify the current platform is supported (optional but good sanity check)
const currentTarget = `bun-${platform}-${arch}`;
if (
	!supportedTargets.includes(currentTarget as BunTarget) &&
	platform !== "windows" // Skip strict check for windows on arm via emulation for now
) {
	console.warn(
		`Warning: Current platform ${currentTarget} is not in the explicit support list, but valid for cross-compilation.`,
	);
}

console.log("Starting build for all supported targets...");

for (const target of supportedTargets) {
	// Extract OS and Arch from the target string (e.g. bun-darwin-arm64)
	// format: bun-<os>-<arch>
	const parts = target.split("-");
	const os = parts[1];
	const archName = parts[2];

	const outfile = `dist/openturbo-${os}-${archName}`;

	console.log(`Building for ${target} -> ${outfile}...`);

	const result = await Bun.build({
		entrypoints: ["./src/cmd.ts"],
		target: "bun",
		compile: {
			target,
			outfile,
		},
	});

	if (!result.success) {
		console.error(`Build failed for ${target}:`, result.logs);
		process.exit(1);
	}
}

console.log("All builds complete!");
