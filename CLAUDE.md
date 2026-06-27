# Softlaunch SDKs (JavaScript)

Open-source feature flag SDKs for JavaScript, TypeScript, and React. Extracted from the main Softlaunch monorepo; tooling and conventions are kept in sync so patterns transfer cleanly between the two repos.

## Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Language**: TypeScript 5 (strict mode)
- **Build**: tsup (esm + cjs + dts)
- **Test**: vitest
- **Lint**: ESLint 9 flat config, Prettier with import sorting
- **Underlying**: wraps `@instantdb/core` / `@instantdb/react` for real-time config delivery

## Structure

```
packages/
  core/                 — Flag evaluation engine, 0 deps (@softlaunch/core)
  js/                   — Vanilla JS SDK (@softlaunch/js)
  react/                — React provider + hooks (@softlaunch/react)
  eslint-config/        — Shared ESLint config (@workspace/eslint-config)
  typescript-config/    — Shared tsconfig (@workspace/typescript-config)
```

## Commands

```
pnpm build                            — Build all packages
pnpm test                             — Run all tests
pnpm typecheck                        — TypeScript checking
pnpm lint                             — Lint
pnpm format                           — Format with prettier
pnpm --filter @softlaunch/core test   — Run core tests only
```

## Conventions

### Type safety (non-negotiable)

- Zero `any`. Use `unknown` + narrowing.
- No type assertions (`as`). No non-null assertions (`!`).
- Strict mode. Use `.at(0)` for array access instead of `[0]`.
- Prefer discriminated unions and exhaustive matching.

### Naming

- Fully qualified, no abbreviations.
- Functions: `evaluateFlag`, `compileClientConfig`
- Variables: `latestConfigVersion`, `hashedContextLookup`

### Code style

- Do what was asked. Nothing more, nothing less.
- Never create files unless absolutely necessary.
- Prefer editing existing files over creating new ones.
- No redundant code. Less is more.

## Releases

Published to npm via the **Publish SDK** GitHub Actions workflow (manual dispatch, OIDC trusted publishing with provenance). Each package is versioned independently.
