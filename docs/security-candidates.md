# Security candidates

`bunx fallow security` reports **candidates for verification, not vulnerabilities**. It matches
syntactic sink sites against a CWE catalogue and asks a human whether attacker-controlled input can
reach one. It is an opt-in surface: its findings never appear under bare `fallow` or in the `audit`
gate, so nothing on this page has ever blocked a commit.

That property cuts both ways — a backlog nobody gates on is a backlog nobody rereads. So the
arrangement here is:

- **The eight candidates standing on `development` are triaged below, once, with the evidence.**
- **CI fails a pull request that makes a *new* one runtime-reachable**
  (`fallow security --gate newly-reachable`, in the `fallow audit (PR gate)` job). There is
  deliberately no `--gate all` mode in fallow; gating on the whole backlog is the anti-feature it
  avoids.

The gate is `newly-reachable` rather than `new`, and the reason is on this page. `--gate new` fires
on any candidate appearing on a changed line, **including an existing sink whose ranking moved** —
which is exactly what adding the origin-confinement test below did to rows 1 and 2. It went red on
the file that closed the finding. `newly-reachable` asks whether a candidate became reachable from
an entry point in head that was not reachable in base: a genuinely new sink does, and a re-ranked
existing one does not. Verified both ways with a probe `dangerouslySetInnerHTML` in `NotFound.tsx`,
which fails the gate.

So this page is the record of what was decided, and the gate is what keeps the page complete. When
a PR fails the security gate, either fix the sink or add a row here.

Re-run the review with:

```bash
bunx fallow security
```

## Triage, as of fallow 3.21.0

| # | Site | Category | Verdict |
| :--- | :--- | :--- | :--- |
| 1 | `src/lib/registries/http.ts:20` | SSRF (CWE-918) | **guarded — asserted by test** |
| 2 | `src/lib/registries/http.ts:29` | SSRF (CWE-918) | **guarded — asserted by test** |
| 3 | `src/components/diff/DiffRow/DiffRow.tsx:45` | XSS (CWE-79) | **guarded — asserted by test** |
| 4 | `src/components/diff/SplitDiffRow/SplitDiffRow.tsx:63` | XSS (CWE-79) | **guarded — asserted by test** |
| 5 | `src/routes/__root.tsx:95` | XSS (CWE-79) | **not attacker-reachable** |
| 6 | `src/routes/__root.tsx:97` | XSS (CWE-79) | **not attacker-reachable** |
| 7 | `src/routes/__root.tsx:100` | XSS (CWE-79) | **not attacker-reachable** |
| 8 | `scripts/check-wasm-types.mjs:35` | Path traversal (CWE-22) | **not attacker-reachable** |

### 1–2 · Non-literal URL passed to `request()`

`getJson` and `getText` both hand `request()` a URL string they did not build. Blast radius 23 —
the widest in the report — because every registry adapter goes through them.

The question is whether a package name can steer the destination **host**. It cannot, and the
reason is structural rather than incidental: every URL in this layer is a constant absolute origin
with the name appended to its path.

```ts
`${REGISTRY_URL}/${encodeURIComponent(name)}`     // npm, crates, pypi
`${PROXY_URL}/${escapeModulePath(name)}/@v/list`  // go
```

A relative path cannot introduce a new authority, however hostile it is. `../../evil.example`
normalizes away inside the same origin; `//evil.example` becomes a path beginning with two slashes,
not a host; `https://evil.example/pkg` becomes a path segment that happens to contain a colon.
Three of the four adapters additionally `encodeURIComponent` the name, so it cannot even leave its
segment; Go does not, because a module path legitimately contains slashes.

**What would break it** is assembling one of these URLs differently — `new URL(name, BASE)` reads
almost the same and *does* let a name replace the base outright. So the property is asserted rather
than argued: `tests/unit/registries/outboundOrigins.test.ts` drives every adapter's `search`,
`versions` and `downloadUrl` with names crafted to escape, and fails unless every recorded request
lands on that registry's own origin.

One consequence worth knowing before it confuses somebody: **adding that test raised fallow's own
severity for these two rows from `low` to `medium`.** Its taint model reads the spec as a module
that receives untrusted input — it is full of strings shaped like hostile URLs — and traces it two
import hops into the sink. The finding did not get worse; the file that proves it is safe got
counted as evidence that something hostile can reach it. Rank accordingly.

That escalation is also why the CI gate is `newly-reachable` and not `new`: it tripped `--gate new`
on the pull request that added the test.

Note that this covers the TypeScript layer only — search, version lists and download links. Package
*content* is fetched by the Rust module (`wasm/diff-wasm/src/package.rs`), which builds its URLs the
same way and is outside every JavaScript analysis.

### 3–4 · `dangerouslySetInnerHTML` in the diff rows

The input here is genuinely attacker-controlled in the strongest sense available: it is arbitrary
source text out of an npm, PyPI, crates.io or Go archive, so anyone who can publish a package can
choose it. A diff viewer that renders `<img onerror=…>` from a package's own source would be
trivially exploitable.

`highlightLine` (`src/lib/diff/highlight.ts`) is the only thing between that text and the DOM.
highlight.js escapes its own output, and the fallback path escapes what it does not mark up. That
guarantee is a dependency's promise, so it is pinned by test rather than assumed —
`tests/unit/diff/highlight.test.ts` asserts escaping on the fallback path, on the path where
highlight.js really does mark the line up, and on a line too long to highlight (#137).

### 5–7 · Inline `<script>` in the document head

`THEME_SCRIPT`, `TREE_WIDTH_SCRIPT` and `GA_SCRIPT` are module-level template literals whose only
interpolations are `JSON.stringify` of other module constants — a storage key, a default theme, two
theme colors, a measurement ID. No request data, route param or user input reaches any of them, and
they are fully determined at build time.

They are inline because they have to be: the first two run before the first paint to set
`data-theme` and the tree width, which is what stops the page rendering in one theme and flipping;
the third is gtag.js's bootstrap queue, which must exist before the async library lands.

### 8 · `path.join()` in `check-wasm-types.mjs`

`file` is one of two module-level string constants naming the generated and checked-in declaration
files. The script takes no arguments and reads no environment, and fallow itself puts its blast
radius at 0 — it is not reachable from any runtime entry point, because it is dev tooling that CI
runs by hand after `build:wasm`.

## Blind spots

The report ends with a note that ~1000 call sites use patterns it could not resolve (dynamic
dispatch, computed members, aliased bindings), most of them in `tests/e2e/`. That is expected for
Playwright specs and is not a finding; `bunx fallow security blind-spots` groups them if the
distribution is ever worth looking at.
