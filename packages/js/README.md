# @softlaunch/js

Softlaunch feature flag SDK for JavaScript. Loads your flag configuration, evaluates flags locally, and stays subscribed for real-time updates — in any JavaScript runtime.

## Install

```bash
npm install @softlaunch/js
```

## Usage

```ts
import { init } from "@softlaunch/js";

const client = init({ sdkKey: "slc_..." });
await client.waitUntilReady();

const showCheckout = client.getBooleanFlag("checkout-redesign", "user-123", { plan: "pro" }, false);

// React to flag changes in real time
const unsubscribe = client.subscribe(() => {
  render(client.getBooleanFlag("checkout-redesign", "user-123", { plan: "pro" }, false));
});

client.close();
```

## Documentation

See [docs.softlaunch.so](https://docs.softlaunch.so).

## License

MIT
