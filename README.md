# Freeman

A personal portfolio tracker for stocks: log buys and sells, see allocation, value over time and
gain/loss, and keep a watchlist with target prices. Prices are entered by hand for now.

Expo SDK 58 · React Native · Expo Router · TanStack Query · react-native-gifted-charts.
The backend is a separate FastAPI + Turso service (`freeman-api`, in the parent `CLaude` repo).

## Screens

| Tab | What it does |
|---|---|
| Dashboard | Portfolio value, value-over-time line, allocation donut (by ticker, sector or asset class) |
| Portfolio | Gain/loss bars and the holdings list; tap a holding for its position screen |
| Watchlist | Tickers you follow, with target price and distance to target; tap to log a price |
| Trades | Every buy and sell; long press to delete |

A position screen shows stats, a price line, that ticker's trades, and a form to set its sector and
asset class (these drive the Sector and Asset class views).

## Run it locally

1. Start the API (see `freeman-api/README.md`). For a phone on your network use `--host 0.0.0.0`.
2. Create `.env.local` (git-ignored) in this folder:

   ```
   EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000
   EXPO_PUBLIC_API_KEY=<the API_KEY from freeman-api/.env>
   ```

   `EXPO_PUBLIC_*` values are bundled into the app, so anyone with the app can read the key. That is
   accepted for a personal single-user app; real accounts replace it later.
3. Install and start:

   ```bash
   npm install
   npx expo start        # then press w for web, or scan the QR code with Expo Go
   ```

## Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # expo lint
npm test              # Jest, fast, no coverage
npm run test:ci       # Jest with coverage and the coverage thresholds (what CI runs)
npx expo-doctor
```

**Route types gotcha.** `expo lint`, `expo export` and `expo install` rewrite the generated
`.expo/types/router.d.ts` in a form that makes `tsc` reject `"/"`. Regenerate it by starting the dev
server once (`npx expo start`), then run `tsc`.

## Tests

**Unit and component tests (Jest + Testing Library).** Run on every push and pull request by
`.github/workflows/ci.yml`, which runs typecheck, lint and `npm run test:ci` in that order. Coverage
must stay above the floor in `jest.config.js`; raise the floor as coverage grows.

- Screen tests live in `src/__tests__/`, hook, component and library tests sit next to their code.
  Keep test files out of `src/app/`: every file there becomes a route.
- `src/test-utils/` has `renderWithClient` (a fresh React Query client per test, with the gc timers
  turned off so Jest can exit) and typed fixtures.
- Tests mock `@/lib/api` and `expo-router`, so they never touch the network. The SVG charts are
  mocked in screen tests; their props are what the screen is responsible for.

**End-to-end flows (Maestro).** `.maestro/` drives the real app: a smoke test of every tab, and
add-then-delete lifecycles for trades and the watchlist. They are not part of CI because they need
an emulator or device.

```bash
# install: https://docs.maestro.dev/getting-started/installing-maestro
npx expo run:android            # or run:ios, or install a development build from EAS
APP_ID=<your app's package or bundle id>
maestro test -e APP_ID=$APP_ID .maestro
```

The lifecycle flows create records named `E2E…` and delete them at the end, but they do write to
whatever API the app points at, so point the app at a test or local API, not your real data. Field
lookups use placeholder text (`AAPL`, `NVDA`, …); if you change a placeholder, update the flows.

## Troubleshooting

**"The method or property X is not available on android" (an `UnavailabilityError`).** Nothing needs
linking by hand: Expo autolinks native modules, and Expo Go ships its own copy of them. This error
means the native module inside the app on your phone is out of step with the JS package in
`node_modules` (Expo sometimes changes a native module in a patch release). Update Expo Go from the
store first. If it persists, build a development client, which compiles the exact native versions this
project uses: `eas build --profile development --platform android`.

Haptics go through `src/lib/haptics.ts`, which never throws, so a missing haptics module only means no
vibration, not a crash. Use that helper for any new haptic feedback instead of calling `expo-haptics`
directly.

## Builds (EAS)

`eas.json` defines three profiles, each tied to an EAS environment of the same name:

| Profile | Use |
|---|---|
| `development` | Development client (needs `expo-dev-client`), internal distribution |
| `preview` | Installable build for testing on your own devices |
| `production` | Store build, build number auto-incremented |

EAS builds do not read `.env.local`. Set the app's variables per environment first:

```bash
eas env:set --name EXPO_PUBLIC_API_URL --value https://<your-api-host> --environment preview --visibility plaintext
eas env:set --name EXPO_PUBLIC_API_KEY --value <key> --environment preview --visibility sensitive
```

Repeat for `development` and `production`. Before the first build, `app.json` also needs an
`ios.bundleIdentifier` and an `android.package`. The API must be reachable from the device, so a build
for use away from home needs the API hosted somewhere public.

```bash
eas build --profile development --platform android
```

## Phases

1. API: trades, watchlist, prices, derived portfolio math (`freeman-api`)
2. App shell, trades list, add-trade flow
3. Charts, holdings list, position detail
4. Watchlist and manual price marks
5. Polish and build configuration (this phase)
6. Later: live price provider, accounts, notifications, offline cache
