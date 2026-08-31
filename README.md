# diffpack

Compare package versions across ecosystems. Clean. Fast. Source-aware.

[diffpack.io](https://diffpack.io)

Paste two versions of a package and read what actually changed between them — the files, the
lines, the renames — without cloning anything or trusting a changelog.

## How it works

**The diff happens in your browser.** diffpack downloads both archives from the registry, unpacks
them and diffs them in a WebAssembly module running in a Web Worker. Package contents never reach
diffpack's own server, which renders the page shell and nothing else — the archives travel
directly between your browser and the registry.

A comparison is a URL — `/{registry}/{package}/{from}/{to}/{file...}` — so any diff you are
looking at is a link you can send to someone.

## Supported registries

| Registry | Packages | Search |
| --- | --- | --- |
| **npm** | JavaScript & TypeScript | yes |
| **crates.io** | Rust | yes |
| **PyPI** | Python | yes |
| **Go** | Go modules | no — type a full module path |

Go has no discovery search: `proxy.golang.org` offers no CORS-enabled search-by-name API, so the
field takes a complete module path (`github.com/go-chi/chi/v5`) instead of a name.

🚧 More registries coming soon. 🚧

## Getting started

Prerequisites: [Bun](https://bun.sh), and — only if you intend to touch the Rust — a Rust
toolchain with the `wasm32-unknown-unknown` target.

```bash
bun install
bun run build:wasm   # required once: the app will not start without it
bun run dev          # http://localhost:4321
```

`build:wasm` compiles `wasm/diff-wasm` into `wasm/diff-wasm/pkg/`, which is generated, gitignored,
and **not** a package.json dependency — the specifier `diff-wasm` resolves through `tsconfig.json`
paths and a Vite alias instead. `bun run dev` does not rebuild it; after editing anything under
`wasm/diff-wasm/src`, re-run `build:wasm` and restart the dev server.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Vite dev server on :4321 |
| `bun run build` | `build:wasm` + `vite build` |
| `bun run preview` | serve the production build |
| `bun run test` | unit tests (`bun test tests/unit`) |
| `bun run test:e2e` | Playwright suite — hits the real registries, so it is slow and needs a network |
| `bun run screenshots` | recapture the reference screenshot set (see `scripts/capture-screenshots.mjs`) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` / `format` | Biome |

## Tech stack

- [TanStack Start](https://tanstack.com/start) + [Router](https://tanstack.com/router) on Vite —
  full-document SSR of the shell, with the diff engine strictly client-side
- [TanStack Query](https://tanstack.com/query) for registry calls,
  [Store](https://tanstack.com/store) for the diff session
- [Base UI](https://base-ui.com) primitives, wrapped in `src/components/ui`
- CSS Modules over a custom-property token layer — no Tailwind
- Rust → WebAssembly (`wasm-pack --target web`) for extraction and diffing
- [Biome](https://biomejs.dev) for linting and formatting

## Deployment

Vercel, via the [Nitro](https://nitro.build) Vite plugin: `vite build` writes a Build Output API
v3 tree to `.vercel/output/` — static assets plus one server function — which Vercel serves as-is.

Two consequences worth knowing before editing deploy config:

- **Routing and headers belong in `nitro({ routeRules })` in `vite.config.ts`, not `vercel.json`.**
  A build that writes `.vercel/output/config.json` brings its own routing table, so rules left in
  `vercel.json` are read by nobody. What `vercel.json` still carries is the build itself: the
  install command (which adds the Rust wasm target and compiles the module) and the build command.
  Check a change landed by reading `.vercel/output/config.json` after `VERCEL=1 bun run build`.
- **The `www.diffpack.io` → `diffpack.io` redirect is a domain setting in the Vercel project**, not
  something this repo configures. `routeRules` match on path, not host.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
