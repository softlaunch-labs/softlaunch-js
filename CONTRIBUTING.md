# Contributing

Thanks for your interest in improving the Softlaunch SDKs.

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install      # install dependencies
pnpm build        # build all packages
pnpm test         # run tests
pnpm typecheck    # type-check
pnpm lint         # lint
pnpm format       # format with Prettier
```

The repo is a pnpm + Turborepo monorepo:

- `packages/core` — `@softlaunch/core`, the evaluation engine (zero dependencies)
- `packages/js` — `@softlaunch/js`, the JavaScript client
- `packages/react` — `@softlaunch/react`, the React provider + hooks

`@softlaunch/js` and `@softlaunch/react` both depend on `@softlaunch/core` via the workspace.

## Pull requests

- Keep changes focused, and add tests where it makes sense (`packages/core` is fully unit-tested).
- Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` before opening a PR.
- Follow the existing code style: strict TypeScript, no `any`, no type assertions.

## Releases

Maintainers publish to npm via the **Publish SDK** GitHub Actions workflow (manual dispatch, OIDC trusted publishing).
