# @softlaunch/react

Softlaunch feature flag SDK for React. A provider and hooks that evaluate flags locally and re-render automatically when your configuration changes.

## Install

```bash
npm install @softlaunch/react
```

## Usage

```tsx
import { SoftlaunchProvider, useBooleanFlag } from "@softlaunch/react";

function App() {
  return (
    <SoftlaunchProvider sdkKey="slc_...">
      <Checkout />
    </SoftlaunchProvider>
  );
}

function Checkout() {
  const { value: showRedesign } = useBooleanFlag("checkout-redesign", "user-123", { plan: "pro" }, false);
  return showRedesign ? <NewCheckout /> : <OldCheckout />;
}
```

## Documentation

See [docs.softlaunch.so](https://docs.softlaunch.so).

## License

MIT
