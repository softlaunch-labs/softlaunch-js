# Softlaunch SDKs for JavaScript

Open-source feature flag SDKs for JavaScript, TypeScript, and React, powered by [Softlaunch](https://softlaunch.so).

SDKs evaluate flags locally against a CDN-served configuration snapshot, so flag checks are instant and update in real time.

## Packages

| Package                               | Description                                |
| ------------------------------------- | ------------------------------------------ |
| [`@softlaunch/react`](packages/react) | Provider + hooks for React apps            |
| [`@softlaunch/js`](packages/js)       | Client for any JavaScript runtime          |
| [`@softlaunch/core`](packages/core)   | Evaluation engine (used by the SDKs above) |

## Quickstart

Install the SDK for your framework:

```bash
npm install @softlaunch/react
# or
npm install @softlaunch/js
```

Then follow the [documentation](https://docs.softlaunch.so).

## Development

A pnpm + Turborepo monorepo.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
