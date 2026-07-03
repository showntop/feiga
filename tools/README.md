# Local Tooling

## Playwright

The `playwright` package is available to the Codex runtime, but its expected browser binary is missing:

```text
chromium_headless_shell-1200
```

This machine has older/newer cached Playwright browsers, but Chromium cannot be launched from the current sandbox because macOS denies the required Mach port registration.

Run this from a normal terminal to install the matching browser:

```bash
npx playwright install chromium
```

Then verify:

```bash
node --test scripts/sim/sim.test.ts
```

## Cocos Creator

Cocos Creator is installed at:

```text
/Applications/Cocos/Creator/3.8.8/CocosCreator.app
```

This repo includes a wrapper:

```bash
./tools/cocos-creator --help
```

If the wrapper is not executable yet:

```bash
chmod +x tools/cocos-creator
```

In the Codex sandbox, launching the Cocos Electron binary currently exits with code `134`. Use a normal terminal or the Cocos Dashboard for editor operations.
