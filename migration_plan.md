# diffpack → Next.js Migration Plan

**Status:** proposal / hand-off document
**Author:** exploration pass over `https://diffpack.io` (live) + `philfreshman/diffpack` @ `development`
**Audience:** the agent(s) that will execute the migration, and whoever splits this into issues
**Reference URL used for exploration:** `https://diffpack.io/npm/node/26.6.0/26.7.0/package.json`

---

## 1. Purpose

diffpack is currently an **Astro 6 static site** whose interactive parts are hand-written imperative
DOM code communicating over `window` `CustomEvent`s, plus a **Rust→WASM** diff engine running in a
**Web Worker**. This document is a complete inventory of what exists today (with screenshots of
every UI element), the target Next.js architecture, the non-obvious hazards, and a phased plan
that can be sliced into issues.

**Explicit non-goals of the migration itself:** no redesign, no new features, no registry additions.
The migration is a **behaviour-preserving port**. Anything that looks like an improvement is called
out separately in §9 so it can be scheduled deliberately rather than smuggled in.

---

## 2. What exists today (inventory)

### 2.1 Stack

| Concern | Today |
| --- | --- |
| Framework | Astro `6.1.3`, `output: 'static'`, `prefetch: true` |
| UI islands | React 19 via `@astrojs/react` (`client:load` only) |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`, `src/styles/global.css` |
| Diff engine | Rust crate `wasm/diff-wasm`, built by `wasm-pack build --target web` |
| Worker | `src/workers/diff.worker.ts`, module worker, imports the WASM package |
| Syntax highlighting | `highlight.js` 11, themes loaded via `import.meta.glob(..., { query: '?raw', eager: true })` |
| Package manager / runtime | Bun |
| Lint/format | Biome 2 |
| Hosting | Vercel (`vercel.json` rewrites + headers), Rust toolchain installed in `installCommand` |
| Analytics | gtag (`G-JH9PM7WWGG`) inlined in `BaseHead.astro` |

### 2.2 Routes and the URL grammar

Physical pages: `src/pages/index.astro`, `npm.astro`, `crates.astro`, `pypi.astro`.
(`rubygems.astro` and `src/registries/rubygems/**` are **staged as deleted** in the working tree —
confirm before porting; the plan assumes three registries.)

The app's real URL space is much larger than its four pages:

```
/<registry>/<package>/<from>/<to>/<file...>
/<registry>/@<scope>/<package>/<from>/<to>/<file...>
```

Deep links do **not** exist as files. They are made to work by **two layers of rewriting**:

1. `src/middleware.ts` — rewrites `/npm/anything/...` → `/npm` (dev + build-time)
2. `vercel.json` `rewrites` — same thing at the CDN edge in production

The served HTML is therefore always the bare registry page; `src/utils/urlParser.ts` re-derives
`{registry, package, from, to, file}` from `window.location.pathname` on the client, and the app
boots itself from that. `history.pushState` is used directly for every subsequent URL change
(version select, file select, Escape-to-close), with a `popstate` listener in the file explorer.

**Consequence worth knowing:** every deep link today serves identical, package-agnostic HTML and
meta tags. There is no per-package SEO.

### 2.3 Component map

```
src/
├── pages/{index,npm,crates,pypi}.astro
├── layouts/
│   ├── Layout.astro              # header + explorer + <slot/> shell for registry pages
│   └── SpaceBackground.astro     # cosmic gradient + 100 generated stars + shooting stars
├── components/
│   ├── BaseHead.astro            # <head>, no-flash theme script, gtag
│   ├── Header/
│   │   ├── Header.astro          # logo, layout, Compare button, boot-from-URL logic
│   │   ├── PackageSearch.astro   # ~330 lines of imperative search+dropdown+history
│   │   ├── SearchInput.astro     # input + search icon / spinner / reset icon states
│   │   ├── SearchResults.astro   # dropdown container (populated via innerHTML)
│   │   ├── VersionSelectors.astro# ~400 lines: two combobox inputs + download links
│   │   └── ThemeToggle.tsx       # React island, cycles light→dark→system
│   ├── FileExplorer/
│   │   ├── FileExplorerPanel.astro # ~700 lines: worker owner, tree render, keyboard nav, resizer
│   │   ├── TreeFilter.astro      # filter input + "show only modified" toggle
│   │   ├── TreeList.astro        # <div role="tree"> target
│   │   └── ResizerHandle.astro
│   └── FileViewer/
│       ├── FileViewer.astro      # ~830 lines: diff parse, unified/split render, custom scrollbar
│       ├── Toolbar.tsx           # React island: expand/fold, split toggle, filename, theme select
│       ├── SplitViewButton.tsx   # React island
│       ├── ThemeSelect.tsx       # React island: highlight.js theme picker
│       ├── DiffArea.astro        # #diff-container / #diff-content / custom scrollbar DOM
│       └── Expand*.astro         # <template> sources cloned by the imperative renderer
├── registries/                   # per-registry application/service/domain triads + shared types
├── workers/diff.worker.ts
└── utils/{urlParser,theme,dom,backend,types}.ts
```

### 2.4 The event bus (this is the architecture)

There is no state container. Islands and inline scripts talk over `window` `CustomEvent`s.
**Porting this faithfully is the core of the migration**, so here is the complete table:

| Event | Dispatched by | Consumed by | Payload |
| --- | --- | --- | --- |
| `package-selected` | PackageSearch, Header (on boot) | VersionSelectors, PackageSearch, Header | `{name, pkg?}` |
| `package-reset` | PackageSearch (reset button) | VersionSelectors, Header | — |
| `versions-loaded` | VersionSelectors | Header (boot → auto-diff), Header (button state) | `{packageName, from, to}` |
| `version-changed` | VersionSelectors | Header (button state) | — |
| `start-diff` | Header (Compare click, boot) | FileExplorerPanel, FileViewer | `{registry, pkg, from, to}` |
| `prefetch-diff` | Header (Compare hover) | FileExplorerPanel | same |
| `loading-file` | FileExplorerPanel | FileViewer (overlay) | `{filename}` |
| `file-diff` | FileExplorerPanel (worker reply) | FileViewer, Toolbar (reset expand state) | `{filename, diff, isDiff}` |
| `hide-diff` | FileViewer (Escape) | FileExplorerPanel (clear selection) | — |
| `expand-all-diff` / `fold-all-diff` | Toolbar | FileViewer | — |
| `toggle-split-view` | SplitViewButton | FileViewer | `boolean` |
| `toolbar-ready` | Toolbar (mount) | FileViewer (re-grab DOM refs) | — |
| `astro:page-load` | Astro router | every inline script (re-init) | — |

Note the `AbortController`-per-init pattern in every Astro script: it exists **only** because
`astro:page-load` re-runs the initialiser. It disappears in React.

### 2.5 Worker & WASM contract

`FileExplorerPanel` owns the single `Worker`. Messages **in**:

- `{type: 'start-diff', registry, pkg, from, to}` → `build_diff_tree_for_package(..., 0.75)`
- `{type: 'prefetch', registry, pkg, from, to}` → `prefetch_package` ×2 (warms the WASM-side cache)
- `{type: 'get-diff', filename, oldPath?}` → `get_diff_for_path`

Messages **out**: `{type:'diff-result', data}` (tree, no `filename`), `{type:'diff-result', filename, data, isDiff}` (single file), `{type:'error', error}`.

Critically, **the WASM module fetches and extracts the packages itself** (`package.rs` uses
`web-sys` fetch from `WorkerGlobalScope`, then `flate2`/`tar`/`zip`), and holds an in-module
`thread_local!` `EXTRACTION_CACHE` plus an `ACTIVE_DIFF` pointer. That means:

- the worker instance is **stateful** — recreating it throws away the package cache and invalidates
  `get_diff_for_path` (it will error with `No active diff context`);
- prefetch-on-hover only pays off if the same worker later serves `start-diff`.

**Migration implication: the worker must be a module-scoped singleton, not per-component.**

### 2.6 Persistence (localStorage keys — must be preserved to avoid breaking returning users)

| Key | Written by | Meaning |
| --- | --- | --- |
| `theme` | `utils/theme.ts` | `light` \| `dark` \| `system` (default `dark`) |
| `highlight_theme` | `ThemeSelect.tsx` | highlight.js theme id, e.g. `base16/3024` |
| `split-view-preference` | `SplitViewButton.tsx` | `"true"` \| `"false"` |
| `tree_panel_width` | `FileExplorerPanel.astro` | px, clamped 220–640, default 320 |
| `tree_show_only_modified` | `FileExplorerPanel.astro` | `"false"` disables the filter (default on) |
| `search_history_<registry>` | `historyService.ts` | last 10 `SearchResult`s, shown on empty focus |

### 2.7 External endpoints

| Registry | Search | Versions | Archive (fetched inside WASM) |
| --- | --- | --- | --- |
| npm | `registry.npmjs.org/-/v1/search` | `registry.npmjs.org/<pkg>` | `registry.npmjs.org/<pkg>/-/<name>-<v>.tgz` |
| crates | `crates.io/api/v1/crates?q=` | `crates.io/api/v1/crates/<name>` | `static.crates.io/crates/<n>/<n>-<v>.crate` |
| PyPI | **`api.diffpack.io/api/search`** | `api.deps.dev/v3/systems/pypi/packages/<n>` | sdist url resolved from `pypi.org/pypi/<n>/<v>/json` |

`src/utils/backend.ts` (the `api.diffpack.io` client) is used **only** by PyPI search. Everything
else is browser-direct. Keep this as-is — moving these calls into Next Route Handlers is a separate,
optional decision (§9).

---

## 3. UI inventory (screenshots)

All screenshots are in [`docs/migration/screenshots/`](docs/migration/screenshots), captured at
1440×900 @2x against production. They are the **visual acceptance baseline** — re-run the capture
script (§8.3) against the Next.js build and compare.

### 3.1 Landing page — registry tiles

Three tiles (npm / crates.io / PyPI), each with a per-tile glow colour applied via **inline
`onmouseover`/`onmouseout` handlers** writing `style.boxShadow` (`index.astro`). Animated starfield
background + cosmic gradient behind them.

| Dark (default) | Light |
| --- | --- |
| ![landing dark](docs/migration/screenshots/01-landing-dark.png) | ![landing light](docs/migration/screenshots/02-landing-light.png) |

Tile hover state (glow + arrow slide via `group-hover:translate-x-1`):

![tile hover](docs/migration/screenshots/03-landing-tile-hover.png)

### 3.2 Registry page — empty state

Header is always mounted; explorer panel and diff area are empty until Compare runs. `Compare` is
disabled (grey) until package + both versions are set.

![npm empty](docs/migration/screenshots/04-npm-empty-state.png)

Header closeup, empty (labels are absolutely positioned above the inputs; version inputs are
`disabled` until a package is chosen):

![header empty](docs/migration/screenshots/05-header-empty.png)

### 3.3 Package search input + dropdown

Debounced 300 ms, min 2 chars, results rendered by `innerHTML` from escaped strings. Right-side icon
is a **three-state slot**: search icon → spinner while loading → reset (×) once a package is locked
in. Empty input on focus shows **search history** from localStorage. Full keyboard support:
↑/↓ cycle (wrapping), Enter selects (or accepts raw typed text if the list is closed), Escape closes.

![search dropdown](docs/migration/screenshots/06-search-dropdown.png)

### 3.4 Version selectors (custom comboboxes, not `<select>`)

Two text inputs, each with its own filtered dropdown; typing substring-filters the version list.
Defaults after load: `from = versions[1]`, `to = versions[0]`. A **download icon** appears next to
each label once a version is set, linking straight at the registry tarball. Selecting a version
rewrites the URL via `pushState` and clears the `file` segment if the package changed.

![version dropdown](docs/migration/screenshots/09-version-dropdown.png)

Header populated (note active blue Compare + reset × in the search field):

![header populated](docs/migration/screenshots/08-header-populated.png)

### 3.5 File explorer panel

Rendered from the WASM diff tree. Per-node: chevron, folder/folder-open/file icon, name coloured by
status (green added / red removed / amber modified+renamed), `RENAMED` pill, and `+n` / `−n` counts
(folders aggregate). Auto-expands while filtering or while "only modified" is on; `expandedKeys` /
`collapsedKeys` track manual overrides. Full `role="tree"` keyboard nav (↑↓←→, Home, End, Enter,
Space) with roving `tabIndex`. Right edge is a drag resizer persisted to localStorage.

| Small package (`node`) | Deep tree (`express` 4→5) |
| --- | --- |
| ![explorer](docs/migration/screenshots/10-file-explorer-panel.png) | ![nested tree](docs/migration/screenshots/21-tree-nested-badges.png) |

Filter input (substring match on full path, keeps ancestors visible):

![tree filter](docs/migration/screenshots/16-tree-filter.png)

"Show only modified" toggled **off** — unchanged files (`README.md`) appear, and the toggle button
itself takes a blue active style:

![show all files](docs/migration/screenshots/17-tree-show-all-files.png)

### 3.6 Toolbar

Left group: expand-all / fold-all toggle, unified↔split toggle, then the current filename.
Right: highlight.js theme `<select>` (native, grouped by `<optgroup>`).

![toolbar](docs/migration/screenshots/11-toolbar.png)
![theme select](docs/migration/screenshots/18-theme-select.png)

### 3.7 Diff viewer

Unified mode: two line-number gutters + content, GitHub-ish add/remove colours, hunk rows, and
**collapsed regions** with 3 lines of context. Highlighting: language is auto-detected **once per
file** from a ≤200-line / ≤20 000-char sample, then applied per row.

| Unified (dark) | Unified (light) |
| --- | --- |
| ![unified dark](docs/migration/screenshots/07-diff-unified-dark.png) | ![unified light](docs/migration/screenshots/14-diff-unified-light.png) |

Split mode (deleted/added runs are zipped into left/right pairs; missing side renders as a filler cell):

![split view](docs/migration/screenshots/12-diff-split-view.png)

Expand-all:

![expanded](docs/migration/screenshots/13-diff-expanded-all.png)

Collapsed-hunk expanders — up/down arrows expand 20 lines at a time; first/last blocks get a single
expand-all arrow; middle blocks also get an inline "expand all" affordance in the label cell:

![expanders](docs/migration/screenshots/15-collapsed-hunk-expanders.png)

**Custom scrollbar** (right edge of the diff area, visible on scroll/hover, auto-hides after 600 ms):
draggable thumb, click-to-jump on the track, and a **minimap of change markers** re-projected on
every render and on `resize`.

### 3.8 Other registries (same shell, different data source)

| crates.io | PyPI |
| --- | --- |
| ![crates](docs/migration/screenshots/22-crates-registry.png) | ![pypi](docs/migration/screenshots/23-pypi-registry.png) |

### 3.9 Mobile

The layout is desktop-first; at 390 px the header and the fixed-width explorer panel do not adapt.
Port as-is — do **not** silently "fix" it; log it as follow-up work.

![mobile](docs/migration/screenshots/19-mobile-diff.png)

---

## 4. Target architecture

### 4.1 Framework decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Router | **App Router** | Metadata API, layouts, server components for the shell |
| Output | **Default (server) on Vercel** — *not* `output: 'export'` | A catch-all deep link can't be pre-enumerated; server rendering also unlocks per-package metadata. `export` would force us to re-create the rewrite hack. |
| Bundler | **Turbopack** (`next dev --turbopack`, `next build --turbopack`) with a webpack fallback config kept in `next.config.ts` | Turbopack handles `new Worker(new URL(...))` and async WASM; keep the webpack branch until CI proves Turbopack builds green |
| State | **Zustand** (single store) — or React Context + `useReducer` if a dependency is unwanted | Replaces the `CustomEvent` bus; the store is the direct translation of the event table in §2.4 |
| Styling | Tailwind v4 via **`@tailwindcss/postcss`** | `@tailwindcss/vite` does not apply |
| Package manager | Bun (unchanged) | |
| Lint | Biome (unchanged) | |

### 4.2 Route shape

```
app/
├── layout.tsx                       # <html data-theme>, fonts, no-flash script, gtag, global.css
├── page.tsx                         # landing (server component) + <RegistryTiles/>
├── [registry]/
│   └── [[...slug]]/
│       ├── page.tsx                 # server: validate registry, build metadata, render shell
│       └── not-found.tsx
```

- `generateStaticParams()` returns `[{registry:'npm'},{registry:'crates'},{registry:'pypi'}]`;
  `dynamicParams = true` lets arbitrary deep links through.
- Unknown registry → `notFound()` (today they silently fall back to npm inside `parseUrl`; keep the
  fallback behaviour **or** decide explicitly to 404 — see §11).
- The `slug` segments are parsed **server-side** with a shared `parseUrl`, passed to the client shell
  as props, so the client no longer has to read `window.location` on boot.
- **`vercel.json` rewrites are deleted.** Keep `cleanUrls`, `trailingSlash`, the `www` redirect, and
  move the cache headers into `next.config.ts` `headers()` (Next already fingerprints and
  long-caches `/_next/static`, so only the `.wasm` rule and the default `s-maxage` rule need porting).

### 4.3 State store (replacement for the event bus)

One store, four slices — mirrors §2.4 one-to-one:

```ts
// store/useDiffStore.ts
{
  // selection
  registry, pkg, from, to, file,
  versions: string[], versionsLoading, searchResults, searchLoading,
  // diff
  tree: DiffFileEntry | null, treeLoading, error,
  activeFile: { filename, diff, isDiff } | null, fileLoading,
  // view prefs (hydrated from localStorage, never during SSR)
  splitView, expandAll, highlightTheme, treeWidth, showOnlyModified, treeFilter,
  // actions
  selectPackage, resetPackage, loadVersions, setVersion,
  startDiff, prefetchDiff, openFile, closeFile,
}
```

Rules for the implementer:

- **URL is derived from the store, not the source of truth after boot.** A single
  `useSyncUrl()` hook writes `history.pushState` (or `router.replace(..., {scroll:false})`) when
  `pkg/from/to/file` change, and a `popstate` listener writes back into the store. Do not scatter
  `pushState` calls across components the way the current code does.
- All localStorage reads happen in `useEffect`, never in render — otherwise hydration mismatches.
  The exception is the theme, handled by the pre-hydration inline script (§4.5).

### 4.4 Worker + WASM (the highest-risk area)

**Constraints to respect:** module worker, singleton, stateful WASM cache, `.wasm` served with the
right MIME and long cache headers.

Recommended shape:

```ts
// lib/diffWorkerClient.ts   ("use client")
let worker: Worker | null = null;
export function getDiffWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/diff.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;                     // module singleton — survives component remounts
}
```

Open sub-decisions, in order of preference:

1. **Keep `wasm-pack --target web` output in `wasm/diff-wasm/pkg` and import it as a local
   file: dependency** (as today), letting the bundler emit the `.wasm`. Requires
   `next.config.ts` → `webpack: (cfg) => { cfg.experiments.asyncWebAssembly = true; return cfg }`
   for the fallback path, and verifying Turbopack emits the asset URL correctly.
2. If asset-URL resolution fights the bundler: **copy `diff_wasm_bg.wasm` into `public/wasm/`** in
   the build script and call `init('/wasm/diff_wasm_bg.wasm')`. Blunt, always works, costs one
   copy step. Decide this early — it affects the build pipeline issue.

Build wiring: `build:wasm` stays (`wasm-pack build --target web wasm/diff-wasm`); `build` becomes
`bun run build:wasm && next build`; the Vercel `installCommand` (rustup target + wasm-pack) stays
exactly as-is. Note the repo just had a Vercel breakage from wasm-pack 0.14 (commit `707cc06`) —
**pin the wasm-pack version and don't touch it during this migration.**

### 4.5 Theme (no-flash) and fonts

- The `BaseHead` IIFE that sets `data-theme` before paint must become a
  `<script dangerouslySetInnerHTML>` in `app/layout.tsx` **inside `<head>`**, before any CSS. Keep
  the exact same logic and the `dark` default; keep `data-theme-selection` too (the CSS custom
  variant `@custom-variant dark (&:where([data-theme="dark"], ...))` depends on `data-theme`).
- `utils/theme.ts` loses its `astro:before-swap` listener and its module-level side effects; expose
  pure functions and drive them from `ThemeToggle`.
- `MiriamLibre-{Regular,Bold}.woff` → `next/font/local`, or keep the `@font-face` in `global.css`
  and the files in `public/fonts/` (lower-risk, zero behaviour change — prefer this for the port).
- gtag → `@next/third-parties/google` `<GoogleAnalytics gaId="G-JH9PM7WWGG" />`.

### 4.6 highlight.js themes — `import.meta.glob` has no Next equivalent

`ThemeSelect.tsx` currently eagerly inlines **23 theme stylesheets** from `node_modules` via Vite's
`import.meta.glob(..., {query:'?raw', eager:true})` and swaps `<style>` text content.

Port options:

- **(a) Recommended:** a small prebuild script copies the 23 files from
  `node_modules/highlight.js/styles/**` into `public/hljs/<id>.css`; `ThemeSelect` `fetch()`es the
  chosen one and sets `style.textContent`. This also unifies the special-cased `nightfall`
  (already served from `public/nightfall.css`) with everything else.
- (b) Static `import themeCss from 'highlight.js/styles/nord.css?raw'` ×23 — Next has no `?raw`;
  needs a custom loader. Avoid.
- (c) Ship a `<link rel="stylesheet">` swap instead of inline `<style>`; simplest, but introduces a
  flash while the sheet loads. Acceptable if (a) is rejected.

### 4.7 Diff rendering — do not naively `map()` 10 000 rows

The current renderer builds rows with `document.createElement` and appends a fragment. It is fast
because it skips React's reconciler, and it re-renders wholesale on every expand/fold/split toggle.

A literal React port (`rows.map(...)`) will regress badly on large files (expand-all on
`express/lib/router/index.js` is ~1 700 rows; PyPI packages go far higher). Two acceptable targets:

- **Recommended:** `DiffViewer` is a React component that owns a `<div ref>` and calls the **existing
  imperative renderer** (ported ~verbatim into `lib/diff/renderDiff.ts`) inside `useLayoutEffect`.
  Lowest risk, preserves behaviour exactly, and keeps the diff-parsing logic testable in isolation.
- **Alternative:** full React rows + `@tanstack/react-virtual`. Cleaner long-term, but virtualisation
  interacts with the custom scrollbar's marker projection and with `scrollIntoView` on tree
  navigation — treat as a **follow-up**, not part of the migration.

The custom scrollbar (thumb drag, track click, marker minimap, 600 ms auto-hide) should move into a
`useCustomScrollbar(contentRef)` hook, ported logic-for-logic.

### 4.8 Misc porting notes

- `src/registries/types.ts` imports `z` from **`astro/zod`** → add `zod` as a real dependency.
- `src/registries/searchService.ts` reads the active registry from
  `document.getElementById('header-container').dataset.registry`. Replace with the store value —
  the DOM-sniffing must not survive.
- `escapeHTML` usage disappears wherever `innerHTML` is replaced by JSX; keep it only where the
  imperative renderer still writes HTML.
- Every `AbortController`-guarded `init*()` + `astro:page-load` pair is deleted.
- `SpaceBackground` star generation must be client-only (`useEffect`) or it will hydrate-mismatch on
  `Math.random()`. Consider generating stars once into a `<canvas>` or memoising the array.
- `public/_redirects` (Netlify-style) appears vestigial next to `vercel.json` — verify and drop.
- `.astro/`, `astro.config.mjs`, `src/env.d.ts`, `src/middleware.ts` are deleted at the end.

---

## 5. Target file layout

```
app/
  layout.tsx  page.tsx  globals.css
  [registry]/[[...slug]]/page.tsx
components/
  landing/RegistryTiles.tsx
  header/{Header,PackageSearch,SearchResults,VersionSelectors,CompareButton,ThemeToggle}.tsx
  explorer/{FileExplorerPanel,TreeFilter,TreeNode,ResizerHandle}.tsx
  viewer/{FileViewer,Toolbar,SplitViewButton,HighlightThemeSelect,DiffArea,ExpandButton}.tsx
  background/SpaceBackground.tsx
  icons/*.tsx                       # unchanged, drop-in
lib/
  diff/{parseDiff,renderDiff,useCustomScrollbar}.ts
  registries/**                     # unchanged application/service/domain triads
  worker/diffWorkerClient.ts
  url/parseUrl.ts                   # unchanged
  theme.ts  dom.ts  backend.ts
store/useDiffStore.ts
workers/diff.worker.ts              # unchanged message protocol
wasm/diff-wasm/**                   # unchanged
public/**                           # + hljs/*.css if §4.6(a)
```

---

## 6. Phases (issue-slicing guide)

Each phase is independently reviewable. Phases 3–6 can run in parallel once Phase 2 lands, because
they only meet at the store interface — **land the store contract first and freeze it**.

### Phase 0 — Decisions & spike (blocking)
- Answer the open questions in §11.
- Spike: Next 15/16 App Router + module worker + `wasm-pack --target web`, rendering one hardcoded
  diff. **This spike is the go/no-go**; do not start the UI port until WASM-in-worker builds and runs
  in both `next dev` and `next build && next start`.

### Phase 1 — Scaffolding
- Next app, TypeScript, Tailwind v4 via PostCSS, Biome config carried over, `global.css` ported
  verbatim (`@theme`, custom `dark` variant, breakpoint resets, fonts).
- `app/layout.tsx` with the no-flash theme script, metadata defaults, gtag, `SpaceBackground`.
- `next.config.ts` with headers; `vercel.json` reduced to redirects (+ install/build commands).
- Build pipeline: `build:wasm` → `next build`, verified on a Vercel preview deploy.

### Phase 2 — Routing, URL state, store contract
- `parseUrl` reused; server-side parsing in `[registry]/[[...slug]]/page.tsx`.
- `generateMetadata` producing per-package titles/OG (`diffpack | node 26.6.0 → 26.7.0`).
- Zustand store with the full shape from §4.3 and **no-op actions**, plus `useSyncUrl()`.
- Landing page + tiles (hover glow reimplemented in CSS rather than inline handlers).

### Phase 3 — Header
- `PackageSearch` (debounce, 3-state icon, history, keyboard nav, escaping) as React.
- `VersionSelectors` (two comboboxes, filtering, defaults, download links) as React.
- `CompareButton` (disabled logic, hover-prefetch).
- Boot-from-URL: package prefilled → versions load → auto `startDiff` when from+to present.

### Phase 4 — Worker + WASM client
- `diffWorkerClient` singleton, typed request/response, store wiring for `start-diff`, `prefetch`,
  `get-diff`, and `error`.
- Verify the prefetch-on-hover cache actually warms (measure: hovering Compare then clicking should
  skip the network fetch).

### Phase 5 — File explorer
- Recursive `TreeNode`, visibility rules (`showOnlyModified` + filter + `hasVisibleDescendants`),
  auto-expand semantics with `expandedKeys`/`collapsedKeys`.
- Full ARIA tree keyboard nav with roving tabindex; selection sync with URL and `popstate`.
- Resizer + localStorage width; the pre-paint `--tree-panel-width` inline script.

### Phase 6 — Diff viewer
- Port the diff parser (`@@` hunk parsing, line numbering, `--- / +++` filtering) as a **pure
  function with unit tests** — this is the piece most worth testing.
- Renderer (unified + split + collapsed rows + expanders), language auto-detect sampling.
- Custom scrollbar hook incl. marker minimap and `resize` handling.
- Toolbar: expand/fold, split toggle, filename, highlight theme select (§4.6).
- Escape-to-close, per-file scroll-position memory, per-file expanded-state memory.

### Phase 7 — Parity, cleanup, cutover
- Run the parity checklist (§7) and the screenshot diff (§8.3).
- Delete Astro (`astro.config.mjs`, `src/pages`, `src/layouts`, `src/middleware.ts`, `.astro/`,
  `src/env.d.ts`, Astro deps), update README/CONTRIBUTING.
- Deploy behind a preview URL, sanity-check real packages across all three registries, then promote.

---

## 7. Parity checklist (acceptance criteria)

Behavioural details that are easy to lose. Every line is a testable assertion.

**URLs**
- [ ] `/npm/node/26.6.0/26.7.0/package.json` loads, selects the file, and shows its diff on first paint
- [ ] Scoped packages work: `/npm/@types/node/20.0.0/20.1.0`
- [ ] URL-encoded and nested file paths round-trip (`lib/router/index.js`)
- [ ] Selecting a version rewrites the URL and **drops the file segment when the package changed**
- [ ] Escape clears the diff and removes only the file segment from the URL
- [ ] Browser back/forward re-selects the right file (`popstate`)

**Search**
- [ ] 300 ms debounce; <2 chars shows nothing; empty + focus shows history (max 10)
- [ ] Icon slot: search → spinner → reset (×)
- [ ] Reset clears input, versions, URL, and refocuses the input
- [ ] ↑/↓ wrap; Enter accepts highlighted item, or raw text when the list is closed; Escape closes
- [ ] Blur closes with the ~100 ms delay so clicks still register

**Versions**
- [ ] Inputs disabled until a package is selected; placeholder cycles `Select version` → `Loading...` → `Error`
- [ ] Defaults to `from = versions[1]`, `to = versions[0]`
- [ ] Typing substring-filters; ↑/↓/Enter/Escape work; click-outside closes
- [ ] Download icons appear only when a version is set and point at the right archive URL
- [ ] Compare enabled only when package + from + to are all set; hover triggers prefetch

**Explorer**
- [ ] Statuses colour-coded; `RENAMED` pill; `+n`/`−n` counts incl. folder aggregation
- [ ] Root single-directory auto-expand; filter/only-modified auto-expand; manual collapse sticks
- [ ] `tree_show_only_modified` default is **on**; toggle takes the blue active style
- [ ] Keyboard: ↑↓←→ Home End Enter Space, roving tabindex, `scrollIntoView({block:'nearest'})`
- [ ] Resizer clamps 220–640 px and persists; width applied before paint (no jump)
- [ ] Worker errors render inline in the panel

**Viewer**
- [ ] Unified: 3 context lines, collapsed blocks labelled `@@ Collapsed N lines @@`
- [ ] Expanders: 20 lines per click; first/last block get a single expand-all arrow; middle blocks get the inline expand-all
- [ ] Split view zips deleted/added runs; missing side is a filler cell; preference persists
- [ ] Expand-all / fold-all; expanded state remembered **per file**; scroll position remembered per file
- [ ] Language auto-detected once per file and reused per row; non-diff (identical/binary-ish) files render as plain content
- [ ] Custom scrollbar: drag, track-click, markers, 600 ms auto-hide, recompute on `resize`
- [ ] highlight.js theme select persists and applies immediately, incl. `nightfall`

**Global**
- [ ] Theme cycles light → dark → system; no flash on load; `system` follows OS changes live
- [ ] All six localStorage keys unchanged in name and value format
- [ ] gtag fires; favicons, webmanifest, OG images unchanged

---

## 8. Verification

### 8.1 Unit tests (new — the migration is the excuse to add them)
- `parseUrl` — scoped/unscoped, missing segments, nested files, unknown registry
- diff parser — hunk headers, line numbering, add/remove/rename headers, `/dev/null` cases
- visibility rules — `hasVisibleDescendants` × filter × only-modified matrix

### 8.2 Integration
- Worker round-trip against a fixture tarball; assert `get-diff` after `start-diff`, and that a
  second `get-diff` hits the WASM cache.

### 8.3 Visual parity
`docs/migration/screenshots/` was produced with a Playwright script (Chrome, 1440×900, `deviceScaleFactor: 2`).
Re-run it against the Next.js preview URL and diff the images pairwise. Keep the script in-repo as
`scripts/capture-screenshots.mjs` so it becomes the regression harness.

### 8.4 Manual smoke matrix
`npm/node`, `npm/express` (deep tree), `npm/@types/node` (scoped), `crates/serde`, `pypi/requests`
— each in light + dark, unified + split.

---

## 9. Improvements deliberately deferred

Not part of the port. Log as separate issues so they are scheduled, not smuggled:

1. **Per-package SEO** — Next unlocks real `generateMetadata`; the current site serves identical
   meta for every deep link. (Cheap; arguably worth doing during Phase 2.)
2. Row virtualisation for very large diffs (§4.7).
3. Responsive/mobile layout (§3.9).
4. Moving registry calls into Route Handlers (caching, rate-limit shielding, hiding
   `api.diffpack.io`) — changes the trust model, decide separately.
5. Word-level intra-line diff highlighting.
6. A shared `Combobox` primitive — search and both version selectors are three copies of the same
   ~200 lines.

---

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WASM/worker doesn't bundle cleanly under Turbopack | Blocks everything | Phase 0 spike is a hard gate; `public/wasm` fallback (§4.4 option 2) |
| Worker recreated on remount → `No active diff context` errors | Diffs silently break after navigation | Module-singleton worker + an explicit test |
| React row rendering regresses perf on big files | Visible jank, worse than today | Keep the imperative renderer (§4.7) |
| `import.meta.glob` theme loading has no direct port | Theme picker breaks | Decided in §4.6 before Phase 6 |
| Hydration mismatches from localStorage/`Math.random()` | Console errors, flashes | All persisted reads in `useEffect`; starfield client-only |
| Losing an undocumented behaviour (scroll memory, expand memory, prefetch warmth) | Quiet UX regressions | The §7 checklist is the review gate |
| Vercel build fragility (rustup + wasm-pack, recently broken) | Failed deploys | Pin wasm-pack; don't touch `installCommand` |

---

## 11. Open questions (need answers before Phase 1)

1. **Next.js version** — pin to the latest stable at execution time (15.x/16.x)? Turbopack builds on
   or off in CI?
2. **State library** — Zustand acceptable, or keep the dependency list minimal with Context?
3. **rubygems** — the working tree has `rubygems.astro` and `src/registries/rubygems/**` staged as
   deleted. Is that intentional and permanent? The plan assumes **three** registries.
4. **Unknown registry behaviour** — today `/foo/bar/1/2` silently falls back to npm. 404 instead, or
   preserve the fallback?
5. **`output: 'export'`** — is server rendering on Vercel acceptable (recommended, §4.2), or is a
   fully static build a hard requirement?
6. **Big-bang or parallel** — port on a long-lived branch and cut over once, or run Next behind a
   preview domain alongside Astro? (Recommended: long-lived branch + preview deploys; the app is
   small enough that a dual-stack period costs more than it saves.)
7. **Testing budget** — is adding Vitest + Playwright in scope, or should the migration ship with
   manual verification only?

---

## Appendix A — Files by port difficulty

| Difficulty | Files |
| --- | --- |
| **Drop-in** (copy, adjust imports) | `components/Icons/*`, `utils/urlParser.ts`, `utils/dom.ts`, `registries/**` (except the `astro/zod` import and the DOM-sniffing in `searchService.ts`), `workers/diff.worker.ts`, `wasm/**`, `public/**` |
| **Light** | `ThemeToggle`, `SplitViewButton`, `Toolbar`, `TreeFilter`, `ResizerHandle`, `DiffArea`, landing tiles, `BaseHead` → metadata |
| **Medium** | `SpaceBackground` (hydration), `ThemeSelect` (§4.6), `utils/theme.ts`, `Header.astro` boot logic |
| **Heavy — the real work** | `PackageSearch.astro` (~330 lines), `VersionSelectors.astro` (~400), `FileExplorerPanel.astro` (~700), `FileViewer.astro` (~830) |

## Appendix B — Commands

Today:

```bash
bun install && bun run dev
```

After migration (expected):

```bash
bun run build:wasm && bun run dev
```
