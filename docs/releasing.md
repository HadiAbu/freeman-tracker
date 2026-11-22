# Releasing

Three build profiles in `eas.json`, each tied to an EAS environment and an update channel of the
same name. A build only ever receives updates from its own channel.

| Profile | For | Distribution | Channel | Environment |
|---|---|---|---|---|
| `development` | Daily work with `expo-dev-client` | internal (APK / ad hoc) | `development` (unused: dev clients load updates from the Extensions UI) | `development` |
| `preview` | Testing a release candidate on real devices | internal (APK / ad hoc) | `preview` | `preview` |
| `production` | The store | store (AAB / App Store) | `production` | `production` |

`production` also auto-increments the build number (`appVersionSource` is `remote`).

## One-time setup

Builds do not read `.env.local`. Set the API URL and key per environment, once each:

```bash
eas env:set --name EXPO_PUBLIC_API_URL --value https://<api-host> --environment preview    --visibility plaintext
eas env:set --name EXPO_PUBLIC_API_KEY --value <key>              --environment preview    --visibility sensitive
# repeat for --environment production (and development if you build dev clients)
```

`eas env:list --environment preview` shows what is set. `app.json` also needs `ios.bundleIdentifier`
and `android.package` before the first store build.

## What needs a new build, and what does not

- **OTA update** (`eas update`): JavaScript, styles and assets. Reaches installed builds without a store release.
- **New build**: anything native: a new native library or config plugin, an Expo SDK upgrade, a
  change to `app.json` native settings (icons, permissions, plugins).
- **Runtime version.** It uses the `appVersion` policy, so it is `expo.version` in `app.json`. An
  update is only delivered to builds with the same runtime version. **Bump `expo.version` whenever
  you ship native changes**, or an update built against the new native code can reach old builds that
  cannot run it.

## Promotion path

```
development build  ->  preview channel  ->  production channel (staged)
```

### 1. Preview

Build once per native change, then publish updates to the preview channel as often as needed:

```bash
eas build --profile preview --platform android      # or ios, or all
eas update --channel preview --environment preview --message "What changed"
```

Install the preview build and test on a device. Release builds fetch an update in the background
and apply it on the next start, so fully close and reopen the app (up to two cold starts).

### 2. Production, staged

A **staged OTA rollout** sends an update to a percentage of installed builds first:

```bash
eas update --branch production --environment production --message "What changed" --rollout-percentage 10
```

Check it, then widen or stop it:

```bash
eas update:edit                      # interactive: pick the update, set a new percentage (100 finishes it)
eas update:revert-update-rollout     # abort: restores the previous update and removes the rollout
```

Only one per-update rollout can be active per branch, platform and runtime version. Publishing a new
update to that branch while one is active stops with a message; add `--force-end-active-rollout` to end
the rollout and publish anyway.

To ship exactly what was tested on preview, without rebuilding the bundle, republish it:

```bash
eas update:republish --destination-channel production
```

(It asks which update group to promote. For the same bundle, keep the preview and production
environment variables equivalent.)

### 3. Production, store releases

```bash
eas build --profile production --platform all
eas submit --profile production --platform android
eas submit --profile production --platform ios
```

- **Android:** the `production` submit profile releases to the `production` track as `inProgress`
  at `rollout: 0.1`, so **10% of users** get it first. Raise the percentage in the Play Console (or
  halt it there). Submitting needs a Google service account key (`serviceAccountKeyPath` in the
  submit profile or a key stored with EAS).
- **iOS:** `eas.json` has no phased-release setting. Turn on **Release update over 7 days using phased
  release** for the version in App Store Connect.

## Rolling back

| Problem | Fix |
|---|---|
| A bad OTA update mid-rollout | `eas update:revert-update-rollout` |
| A bad OTA update at 100% | `eas update:rollback`, or `eas update:roll-back-to-embedded` to fall back to the update inside the store build |
| A bad store build | Halt the Play rollout; for iOS pause the phased release, then ship a fixed build |

## Check what is live

```bash
eas channel:view production     # which branch the channel points at
eas update:list --branch production
eas branch:list
```

Nothing in CI publishes updates or builds. Releases are run by hand so each one is a deliberate act.
