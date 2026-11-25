# Conventions

Short rules so the code reads as if one person wrote it. Where a tool can enforce a rule, it does:
`npm run lint`, `npm run format:check` and `npm run typecheck` run in CI.

## Formatting and linting

- **Prettier** formats everything (`.prettierrc`: 100 columns, single quotes, trailing commas).
  Run `npm run format`, or turn on format-on-save (`.vscode/settings.json` already does).
- **ESLint** (`eslint.config.js`) adds correctness rules. `eslint-config-prettier` turns off the ones
  that would argue with Prettier, so there is no style debate between the two.
- Formatting-only commits are listed in `.git-blame-ignore-revs`. Enable it once so `git blame`
  skips them: `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## TypeScript

- `strict` is on, plus `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns` and
  `noUnusedParameters`.
- No `any` (lint error). Use `unknown` and narrow it. No `@ts-ignore`; if a suppression is really
  needed, use `@ts-expect-error` with a reason, so it fails when the problem is fixed.
- Type-only imports use `import type` (or `import { type X }`); lint fixes this for you.
- Import with the `@/` alias (`@/components/ui/button`), not `../../`.
- Types shared with the API live in `src/types.ts`. Do not redeclare them in a screen.

## Components

- One component per file, named for the file (`holding-row.tsx` exports `HoldingRow`). Files are
  `kebab-case`, components `PascalCase`, hooks `use-thing.ts` exporting `useThing`.
- Put it in the folder from [architecture.md](architecture.md#srccomponents). If you are about to
  copy markup or styles from another screen, extract a component instead (see `ScrollScreen`,
  which replaced five identical hand-built page frames).
- Do not extract speculatively. Two real uses is the bar; "it might be reused" is not.
- Wrap a section that can fail on its own in `<ErrorBoundary>`. A boundary only catches errors
  thrown while rendering, not errors in event handlers or async code.
- Every new component gets a test next to it. Query by what a user sees (text, role, label), not by
  implementation details.
- Meaning is never carried by color alone: a stale price says "stale" in words, an error has text.

## Comments

Comment **why**, not what. The code already says what it does.

```ts
// Bad: increments the counter
count += 1;

// Good: refresh tokens are single use, so parallel refreshes would look like a replay
// and end the session. Share one request instead.
if (inFlight) return inFlight;
```

Write a comment when:

- the reason is not visible in the code (a workaround, a platform quirk, a business rule such as
  "stale after 4 days: a weekend plus a holiday");
- a limit would surprise the next reader (what an error boundary does not catch);
- a security or privacy decision is being made (what is kept in memory, what is in the keychain).

Use `/** ... */` on exported functions and components when the name and types do not tell the whole
story, so the explanation shows up in the editor tooltip. Do not restate the parameter types.

## Errors and money

- Report a handled error with `reportError` (`src/lib/error-reporting.ts`). Never `console.log` it,
  and never put amounts, prices, share counts or tokens in an error message.
- Format money with `useMoney()` so hide-balances is respected.
- Screens call hooks; hooks call `lib/api.ts`. Nothing else calls `fetch`.

## Commits and branches

Work happens on a phase branch (`phase-11-code-quality`), merged to `master` with `--no-ff` when the
phase is verified. Phase branches are kept as rollback points and never deleted. Commit messages
follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`).
