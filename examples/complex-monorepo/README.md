# Complex Monorepo Example

This is a complex example of a monorepo workspace setup using Bun. It simulates a real-world scenario with multiple packages, libraries, and applications with inter-dependencies.

## Structure

```
.
├── apps
│   ├── backend          # Depends on: @complex/utils, @complex/types
│   └── frontend         # Depends on: @complex/utils, @complex/types, @complex/ui-lib
├── libs
│   └── ui-lib           # Depends on: @complex/constants
└── packages
    ├── constants        # Base package
    ├── types            # Base types
    └── utils            # Depends on: @complex/constants
```

## Dependency Graph

- `@complex/frontend` -> `@complex/ui-lib`, `@complex/utils`, `@complex/types`
- `@complex/backend` -> `@complex/utils`, `@complex/types`
- `@complex/ui-lib` -> `@complex/constants`
- `@complex/utils` -> `@complex/constants`
- `@complex/types` -> (no deps)
- `@complex/constants` -> (no deps)

## Scripts

Each package has stub scripts that simulate work with random delays (to test parallel execution).

- `build`: Simulates a build process (500-2500ms)
- `test`: Simulates a test suite (200-1200ms)
- `lint`: Runs biome check
- `typecheck`: Runs tsc

## Usage

1. **Install dependencies**:
   Run `bun install` from this directory.

2. **Run all builds**:
   ```bash
   bun run build
   ```
   This uses `bun run --filter '*' build` internally.

3. **Run specific task**:
   ```bash
   bun run --filter '@complex/frontend' build
   ```

4. **Verify graph**:
   You can use `openturbo` or recursive bun commands to test the dependency graph resolution.
   For example, building `frontend` should ensure `ui-lib`, `utils`, `types`, and `constants` are built (if utilizing a smart runner). Standard `bun run` just runs the script in the target package.

## Simulation Details

The `build.ts` and `test.ts` files in each package use `setTimeout` with `Math.random()` to simulate realistic build times. This is useful for testing task runners that optimize parallel execution.
