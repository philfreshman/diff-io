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
`wasm32`, and are the fastest way to pin what a diff renders:

```bash
cd wasm/diff-wasm && cargo test
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
four jobs:

| Job | Runs | Needs |
| :--- | :--- | :--- |
| `typecheck, lint, unit tests` | `typecheck`, `lint`, `format`, `test` | bun only |
| `end-to-end` | `cargo test`, `build:wasm`, `check:wasm-types`, `test:e2e` | bun + Rust + Chromium |
| `fallow audit (PR gate)` | `fallow audit --gate new-only`, SARIF upload | bun, PRs only |
| `fallow (full repo)` | full-repo `fallow`, SARIF upload, baseline commit | bun, pushes to `development` only |

The first two are split so a broken type or a failing unit test goes red in under a minute rather
than behind a wasm compile. The first job deliberately never builds the wasm, which makes it the
enforcement of the toolchain-less smoke test above: a `typecheck` that starts needing
`wasm/diff-wasm/pkg/` fails there.

`check:wasm-types` runs only in CI, because it is the one place both the checked-in declaration and
the generated `pkg/` exist at once. On an e2e failure the Playwright HTML report and traces are
uploaded as a `playwright-report` artifact on the run.

The two `fallow` jobs mirror the pre-commit hook's `--gate new-only` behavior on PRs and add a
full-repo run on `development` itself, which catches drift on files no PR touched — something
`--gate new-only` will never do, by design. That job also re-saves the per-analysis baseline files
(`dead-code-baseline.json`, `health-baseline.json`, `dupes-baseline.json`) committed at the repo
root, so a local `fallow --baseline` run stays in agreement with CI. These jobs exist to catch a PR
opened with `--no-verify`, which skips the local hook entirely.

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
