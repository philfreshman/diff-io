# Contributing to diffpack

Thank you for your interest in contributing to diffpack! This document provides guidelines and instructions for contributing to this project.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.x or later)
- A Rust toolchain with the `wasm32-unknown-unknown` target — needed to **run or build** the app,
  not only for Rust work, because the app will not start without the compiled module. Typechecking,
  linting and the unit tests do not need it.

### Setup

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Build the WebAssembly module — **required before the first `dev`**:
   ```bash
   bun run build:wasm
   ```
4. Start the development server:
   ```bash
   bun run dev
   ```

Steps 1 and 2 alone are enough to check that a clone is sound:

```bash
git clone && bun install && bun run typecheck   # must exit 0, no Rust toolchain
```

That is the contributor smoke test, and the pre-commit hook holds to the same standard: neither
needs `wasm/diff-wasm/pkg/`. `bun run build:wasm` is only required to actually run (`dev`,
`preview`) or build the app.

### WASM development

The extraction and diffing logic is Rust, compiled to WebAssembly with
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/), and it is the module — not the
TypeScript — that downloads and unpacks the archives.

`bun run dev` does **not** rebuild it. After editing anything under `wasm/diff-wasm/src`, re-run
`bun run build:wasm` and restart the dev server.

Its output, `wasm/diff-wasm/pkg/`, is generated and gitignored, and is deliberately **not** a
`package.json` dependency: a `file:` dependency breaks `bun install` in environments without a Rust
toolchain, and breaks Renovate's lockfile updates. The `diff-wasm` specifier resolves through the
`paths` entry in `tsconfig.json` and the `resolve.alias` entry in `vite.config.ts` instead.

Those two resolve it to different places, on purpose. Vite aliases it to the generated `pkg/`, the
real module. `tsc` reads the checked-in `wasm/diff-wasm/types/diff-wasm.d.ts` instead, so
`bun run typecheck` never depends on output only a Rust toolchain can produce.

That declaration is hand-written, so it can fall behind `wasm/diff-wasm/src/lib.rs`. **After
changing any `#[wasm_bindgen]` signature, update it** and check it:

```bash
bun run build:wasm && bun run check:wasm-types
```

The check compares the declared signatures against the generated `pkg/diff_wasm.d.ts` and fails on
any divergence. It needs the toolchain, so it runs in CI rather than in the pre-commit hook.

### Tests

```bash
bun run test        # unit — pure functions, fast, no network
bun run test:e2e    # Playwright — drives the real app against the real registries
```

The e2e suite downloads real archives, so it is slow and needs a network. It is the only place the
WebAssembly actually runs, which is why the coverage lives there rather than in mocked unit tests.

`test:e2e` builds and serves the app itself — a **production** build, never `vite dev`. Three
defects have reached `development` past a green dev-only run (`7bd9d90`), so the build is part of
the command rather than a prerequisite you might forget. That means it needs the Rust toolchain,
and that each run pays for a rebuild (about a second once cargo is warm).

It also serves with `--strictPort`, and that is not a detail. Left to itself `vite preview` shrugs
at a busy port and moves to the next one while Playwright goes on polling the original — so the
suite runs green or red against **whatever else is answering there**, which in a repo worked on in
several worktrees at once is somebody else's build. It has to die instead.

Two ways to keep out of another worktree's way:

```bash
PORT=4399 bun run test:e2e                            # serve somewhere else entirely

bun run preview                                       # or point at a server you are already
BASE_URL=http://localhost:4321 bunx playwright test    # running, and skip the rebuild
```

The Rust engine has its own tests, which no `bun` script runs — they compile for the host, not for
`wasm32`, and are the fastest way to pin what a diff renders. They cover everything the engine does
without a browser in front of it: archive extraction and path normalisation, the registry URL
builders, rename detection, the tree's statuses and counts, and the serialised shape TypeScript
reads. What they cannot reach is the handful of functions that *are* the JS boundary — `fetch`,
and the `#[wasm_bindgen]` entry points — because constructing a `JsValue` off `wasm32` aborts the
process. Those are what `tests/web.rs` is for, under `wasm-pack test`.

The engine is formatted by `rustfmt`, checked in CI. There is no pre-commit hook for it, so run it
yourself before pushing:

```bash
cd wasm/diff-wasm
cargo test
cargo fmt --all          # `--all --check` to see what it would change, which is what CI runs
```

### The pre-commit hook

`.husky/pre-commit` runs, in order: `typecheck`, `lint`, `format`, `test`, then
[`fallow audit`](https://fallow.tools) scoped to what your branch changed against its upstream (or
`development` if it has none). Measured on this repo: typecheck ~2.1s, lint ~1.4s, format ~0.1s,
test ~0.3s, `fallow audit` ~1.4s warm — about 5.3s total.

`fallow audit --gate new-only` (the default, and what the hook passes) only blocks findings **your
change introduces** — unused exports, new complexity, duplication, and the rest of what
`.fallowrc.jsonc` enables. Findings already on `development` in files you did not touch do not
block you.

**`fallow audit` analyzes the working tree, not the index.** If you `git add` part of a file and
leave the rest unstaged, the hook can still fail on the unstaged code, because it looks at what is
on disk, not what `git commit` is about to record. This is inherent to how `--base` diffing works
and is not configurable — stage the whole file, or `git stash --keep-index` before committing if
you need to test the staged-only state.

`git commit --no-verify` skips the entire hook, tests included. It is a legitimate escape hatch
when you know the hook is wrong for your situation — e.g. a WIP commit on a scratch branch you will
squash, or a `fallow` false positive you are about to fix in the next commit anyway — but it is not
a way around a finding you disagree with; open an issue or adjust `.fallowrc.jsonc` instead. Claude
Code commits are gated separately (`.claude/hooks/fallow-gate.sh`, installed via
`fallow hooks install --target agent`) and cannot reach for `--no-verify` to bypass it.

### CI

`.github/workflows/ci.yml` runs on every pull request to `development` and on every push to it, in
five jobs:

| Job | Runs | Needs |
| :--- | :--- | :--- |
| `typecheck, lint, unit tests` | `typecheck`, `lint`, `format`, `test`, `check:badge` | bun only |
| `rustfmt, engine tests` | `cargo fmt --all --check`, `cargo test` | Rust only |
| `end-to-end` | `build:wasm`, `check:wasm-types`, `test:e2e` | bun + Rust + Chromium |
| `fallow audit (PR gate)` | `fallow audit --gate new-only`, `fallow security --gate newly-reachable`, SARIF upload | bun, PRs only |
| `fallow (full repo)` | full-repo `fallow`, the type-aware pass, the health grade, SARIF upload, baseline artifact | bun, pushes to `development` only |

The first three are split so a broken type, a failing unit test or an unformatted Rust file goes
red in under a minute rather than behind a wasm compile and a browser download — which is why
`cargo test` runs in its own job rather than in `end-to-end`, where it used to sit. The first job deliberately never builds the wasm, which makes it the
enforcement of the toolchain-less smoke test above: a `typecheck` that starts needing
`wasm/diff-wasm/pkg/` fails there.

`check:wasm-types` runs only in CI, because it is the one place both the checked-in declaration and
the generated `pkg/` exist at once. On an e2e failure the Playwright HTML report and traces are
uploaded as a `playwright-report` artifact on the run.

The two `fallow` jobs mirror the pre-commit hook's `--gate new-only` behavior on PRs and add a
full-repo run on `development` itself, which catches drift on files no PR touched — something
`--gate new-only` will never do, by design. That job also re-saves the per-analysis baseline files
(`dead-code-baseline.json`, `health-baseline.json`, `dupes-baseline.json`) and publishes them as a
`fallow-baselines` artifact on the run. It does not commit them back: `development` has required
status checks, so a push from the job is rejected outright, and a `GITHUB_TOKEN` push would not
trigger the checks that would clear it either. To refresh the checked-in baselines, download the
artifact from the latest `development` run (or regenerate them locally with the same three
`--save-baseline` commands) and open a normal PR. These jobs exist to catch a PR opened with
`--no-verify`, which skips the local hook entirely.

### What `fallow` enforces here

`.fallowrc.jsonc` is commented line by line — every exception it holds says why it exists, and a new
one is expected to do the same. Four things in it are worth knowing before you hit them.

**Architecture boundaries.** `src/` is three zones, and imports only run downhill:

```
routes  →  components  →  lib
```

`src/lib/**` may import from neither of the other two. That is the rule with teeth: `lib` is the
part of this codebase that is pure and unit-tested — URL parsing, the registry adapters, the diff
parser, the worker client, the storage prefs — and one import of a component from there is every
one of those tests needing a DOM. Nothing had to be refactored to turn this on; it was already true,
and now it cannot quietly stop being.

Every file under `src/` must belong to a zone, so a new top-level directory there is a finding
rather than a silent exemption — decide which layer it is, or add it to `coverage.allowUnmatched`
with a reason. Before editing:

```bash
bunx fallow guard src/lib/registries/npm.ts   # which rules apply to this file
bunx fallow list --boundaries                 # the zones, and how many files each holds
```

**House rules.** `rule-packs/diffpack-policy.jsonc` holds two, both currently at zero:

- `localStorage` is reachable only from the module that owns the key. The six key names are a
  compatibility contract with returning visitors (see CLAUDE.md); they survive only while every read
  and write goes through the module the e2e suite imports the constant from. The rule is scoped to
  `src/**` — `tests/e2e/` and `scripts/` drive the *browser's* storage through `page.evaluate`,
  which is a fixture, not a preference read.
- Registry adapters take the injected `Fetcher` rather than calling the global `fetch`, which is
  what keeps `tests/unit/registries/` able to run without a network.

```bash
bunx fallow rule-pack test rule-packs/diffpack-policy.jsonc
```

**Security candidates.** `bunx fallow security` is a separate, opt-in surface — its findings never
appear under bare `fallow` or in the audit gate. The candidates standing on `development` are
triaged once, with evidence, in [docs/security-candidates.md](docs/security-candidates.md); CI fails
a PR that makes a *new* one reachable from an entry point (`--gate newly-reachable`, not
`--gate new` — the latter also fires when an existing sink's ranking moves, which the triage test
itself caused). If that step goes red, either fix the sink or add a row to that file.

**The type-aware pass** (`--type-aware`) runs in CI only, on pushes to `development`. It is the
semantic answer to a question the syntactic pass can only guess at — whether an export really has no
consumers — so it has work to do exactly when something is not clean, and reports `executed: false`
otherwise. It is deliberately not in the pre-commit hook: the hook's whole argument is that it stays
around five seconds. Locally:

```bash
bunx fallow dead-code --type-aware --symbol-impact src/lib/theme.ts:THEME_STORAGE_KEY
```

**The health grade** is the badge at the top of the README, and it is a committed SVG rather than a
service call — `fallow health --format badge` emits the image itself, not a shields.io URL. So it
can go stale, and something has to notice: `bun run check:badge` regenerates the badge and diffs it
against the committed one, and it runs in the `typecheck, lint, unit tests` job. That is the same
contract `check:wasm-types` already holds for the wasm declaration.

It cannot be refreshed by CI on your behalf — pushes from a workflow to `development` are rejected
by its own required checks, which is the wall the baselines above already hit. So when a change
moves the score, the fix is one command:

```bash
bun run badge   # then commit .github/badges/fallow-health.svg
```

The same grade, with the per-threshold detail behind it, is also written to the job summary of every
`fallow (full repo)` run. Locally: `bunx fallow health --format github-summary`.

## Development Workflow

- **Branching**: Create a feature branch for your changes.
- **Code Style**: We use [Biome](https://biomejs.dev) for linting and formatting — tabs, double
  quotes. Run it with:
  ```bash
  bun run format
  ```
- **Styling**: CSS Modules, no Tailwind. A component that has a stylesheet lives in its own folder
  with it (`components/ui/Button/{Button.tsx,Button.module.css}`), so the pair moves as a unit.
  Shared values are custom properties in `src/styles/globals.css`; components read
  `var(--color-foreground)` rather than branching on the theme themselves.
- **Commits**: We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Conventional Commits

Commit messages must follow this format:
`<type>[optional scope]: <description>`

### Commit Types

| Type | Description |
| :--- | :--- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc) |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `perf` | A code change that improves performance |
| `test` | Adding missing tests or correcting existing tests |
| `build` | Changes that affect the build system or external dependencies (example scopes: bun, npm) |
| `ci` | Changes to our CI configuration files and scripts |
| `chore` | Other changes that don't modify src or test files |
| `revert` | Reverts a previous commit |

## Pull Request Process

1. Ensure your code follows the existing style and passes formatting checks.
2. Update the README.md or other documentation if your changes introduce new features or change existing ones.
3. Submit a Pull Request with a clear description of your changes.
4. CI must be green before it can merge. It runs the same commands the hook does, plus the tests —
   so anything that passes locally should pass there.
