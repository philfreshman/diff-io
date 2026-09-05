# AGENTS.md

**Read [CLAUDE.md](CLAUDE.md) first.** It is this repo's agent guide: the commands, the diff
pipeline, the worker protocol, the registry adapters, the routing rules, the deployment shape and
the CSS conventions all live there, and it is the file kept current. Nothing on this page repeats
it — duplicating project facts across two files is how the two start disagreeing.

This file exists for one thing CLAUDE.md does not cover: how to ask
[fallow](https://fallow.tools) a question instead of guessing at the answer.

## The gates you are working inside

Three of them, and they run the same analysis:

| Gate | Where | Scope |
| :--- | :--- | :--- |
| `.husky/pre-commit` | human commits | `fallow audit --gate new-only` against the branch's upstream |
| `.claude/hooks/fallow-gate.sh` | agent `git commit` / `git push` | the same audit, and `--no-verify` does not reach it |
| `.github/workflows/ci.yml` | PRs and pushes to `development` | the PR gate, plus a full-repo run on `development` |

So a finding you introduce blocks the commit. The point of the commands below is to answer the
question the finding raises *before* reaching for a suppression: `.fallowrc.jsonc` records a reason
for every exception it holds, and a `fallow-ignore` comment with no argument behind it will not
survive review.

## Project-specific configuration

- **`.fallowrc.jsonc`** — every entry carries a comment saying why it exists. Read it before adding
  another.
- **Architecture boundaries** are enforced: `routes` → `components` → `lib`, and `src/lib/**` may
  import from neither of the other two. `fallow guard <file>` shows what applies to a file before
  you edit it; `fallow list --boundaries` prints the zones. Every file under `src/` must belong to
  a zone, so a new top-level directory there is a finding, not a silent exemption.
- **`rule-packs/diffpack-policy.jsonc`** — two house rules: `localStorage` is reachable only from
  the module that owns the key, and registry adapters take the injected `Fetcher` rather than
  calling the global `fetch`. Both are at zero; check with `fallow rule-pack test`.
- **CRAP is advisory here** (`maxCrap` is set out of reach). Rank with it, never gate on it — the
  scores are `static_estimated`, not coverage-backed.

<!-- generated:task-matrix:start -->
| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` |
| prove a TypeScript symbol's exact consumers before refactoring | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>` |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base <ref>` |
| prioritize refactoring | `fallow health --hotspots --targets` |
| ask who owns code | `fallow health --ownership` |
| check untested-but-reachable code | `fallow health --coverage-gaps` |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `fallow flags` |
| check which architecture rules apply to a file before changing it | `fallow guard <files>` |
| surface security candidates | `fallow security` |
| understand a finding | `fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- generated:task-matrix:end -->

The table is generated — `bunx fallow init --agents` refreshes it between the markers. The prose
around it is not, so do not let that command overwrite this file wholesale.

## Two things fallow will not tell you

- **The engine is Rust.** `wasm/diff-wasm/` is outside every analysis on this page. It has its own
  tests and its own formatter (`cd wasm/diff-wasm && cargo test`, `cargo fmt --all`), both gated by
  the `rustfmt, engine tests` CI job, and the checked-in TypeScript declaration for it drifts
  unless `bun run check:wasm-types` is run after `bun run build:wasm`.
- **The DOM, the worker and the wasm are covered by Playwright, not by unit tests**, because the
  engine only runs in a browser. `fallow health --coverage-gaps` cannot see that coverage, so treat
  "untested" on a component as a question, not a verdict.
