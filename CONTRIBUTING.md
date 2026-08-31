# Contributing to diffpack

Thank you for your interest in contributing to diffpack! This document provides guidelines and instructions for contributing to this project.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.x or later)
- A Rust toolchain with the `wasm32-unknown-unknown` target — needed for the **first** run, not
  only for Rust work, because the app will not start without the compiled module

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

### Tests

```bash
bun run test        # unit — pure functions, fast, no network
bun run test:e2e    # Playwright — drives the real app against the real registries
```

The e2e suite downloads real archives, so it is slow and needs a network. It is the only place the
WebAssembly actually runs, which is why the coverage lives there rather than in mocked unit tests.

The pre-commit hook runs `typecheck`, `lint` and `format` — **not** the tests. Run them yourself.

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
