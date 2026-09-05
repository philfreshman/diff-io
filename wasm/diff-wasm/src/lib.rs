mod core;
mod package;
mod types;

// The native surface `examples/bench.rs` drives: extraction and the tree
// builder without a fetch in front of them. Nothing here reaches JS — only
// the `#[wasm_bindgen]` functions below do.
pub use crate::core::build_diff_tree;
pub use crate::package::extract_archive_bytes;
pub use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

/// One extracted package, shared between the cache and whoever is reading it.
/// The cache keeps a package for the session, and a diff only reads it, so a
/// hit hands out another `Rc` rather than a copy of every file's content —
/// which was two 80 MB copies per diff on a large crate, in memory wasm
/// never returns (#159).
type PackageFiles = Rc<HashMap<String, FileMapEntry>>;

#[derive(Clone)]
struct ActiveDiff {
    from_key: String,
    to_key: String,
}

thread_local! {
    static EXTRACTION_CACHE: RefCell<HashMap<String, PackageFiles>> =
        RefCell::new(HashMap::new());
    static ACTIVE_DIFF: RefCell<Option<ActiveDiff>> = RefCell::new(None);
}

fn cache_key(registry: &str, pkg: &str, version: &str) -> String {
    format!("{registry}:{pkg}:{version}")
}

async fn get_or_fetch_package(
    registry: &str,
    pkg: &str,
    version: &str,
) -> Result<PackageFiles, JsValue> {
    let key = cache_key(registry, pkg, version);
    if let Some(cached) = EXTRACTION_CACHE.with(|cache| cache.borrow().get(&key).cloned()) {
        return Ok(cached);
    }

    let files = Rc::new(package::fetch_and_extract_package(registry, pkg, version).await?);
    EXTRACTION_CACHE.with(|cache| {
        cache.borrow_mut().insert(key, Rc::clone(&files));
    });
    Ok(files)
}

fn file_content<'a>(files: &'a HashMap<String, FileMapEntry>, path: &str) -> Option<&'a str> {
    files.get(path).and_then(|entry| match entry.file_type {
        FileType::File => Some(entry.content.as_str()),
        FileType::Directory => None,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffResult {
    data: String,
    is_diff: bool,
}

fn build_diff_result(
    filename: &str,
    from_content: Option<&str>,
    to_content: Option<&str>,
    ignore_whitespace: bool,
) -> DiffResult {
    match (from_content, to_content) {
        (None, None) => DiffResult {
            data: "File not present in either version.".to_string(),
            is_diff: false,
        },
        (None, Some(to)) => {
            let header = format!("--- /dev/null\n+++ to/{filename}");
            let mut lines = Vec::new();
            lines.push(header);
            for line in to.split('\n') {
                lines.push(format!("+ {line}"));
            }
            DiffResult {
                data: lines.join("\n"),
                is_diff: true,
            }
        }
        (Some(from), None) => {
            let header = format!("--- from/{filename}\n+++ /dev/null");
            let mut lines = Vec::new();
            lines.push(header);
            for line in from.split('\n') {
                lines.push(format!("- {line}"));
            }
            DiffResult {
                data: lines.join("\n"),
                is_diff: true,
            }
        }
        (Some(from), Some(to)) => {
            if from == to {
                DiffResult {
                    data: to.to_string(),
                    is_diff: false,
                }
            } else {
                DiffResult {
                    data: core::get_diff_content(filename, from, to, ignore_whitespace),
                    is_diff: true,
                }
            }
        }
    }
}

#[wasm_bindgen]
pub async fn prefetch_package(
    registry: String,
    pkg: String,
    version: String,
) -> Result<(), JsValue> {
    let _ = get_or_fetch_package(&registry, &pkg, &version).await?;
    Ok(())
}

#[wasm_bindgen]
pub async fn build_diff_tree_for_package(
    registry: String,
    pkg: String,
    from: String,
    to: String,
    similarity_threshold: f64,
    ignore_whitespace: bool,
) -> Result<JsValue, JsValue> {
    let (from_files, to_files) = futures::join!(
        get_or_fetch_package(&registry, &pkg, &from),
        get_or_fetch_package(&registry, &pkg, &to)
    );
    let from_files = from_files?;
    let to_files = to_files?;
    let tree = core::build_diff_tree(
        &from_files,
        &to_files,
        similarity_threshold,
        ignore_whitespace,
    );

    let from_key = cache_key(&registry, &pkg, &from);
    let to_key = cache_key(&registry, &pkg, &to);
    ACTIVE_DIFF.with(|state| {
        *state.borrow_mut() = Some(ActiveDiff { from_key, to_key });
    });

    Ok(serde_wasm_bindgen::to_value(&tree)?)
}

#[wasm_bindgen]
pub fn get_diff_for_path(
    filename: String,
    old_path: Option<String>,
    ignore_whitespace: bool,
) -> Result<JsValue, JsValue> {
    let active = ACTIVE_DIFF
        .with(|state| state.borrow().clone())
        .ok_or_else(|| JsValue::from_str("No active diff context"))?;
    let from_key = active.from_key;
    let to_key = active.to_key;

    // Two `Rc` clones let go of the cache's `RefCell` borrow; the file
    // contents themselves are read in place, not copied out first.
    let (from_files, to_files) = EXTRACTION_CACHE.with(|cache| {
        let cache = cache.borrow();
        (cache.get(&from_key).cloned(), cache.get(&to_key).cloned())
    });

    let from_path = old_path.as_deref().unwrap_or(&filename);
    let from_content = from_files
        .as_deref()
        .and_then(|files| file_content(files, from_path));
    let to_content = to_files
        .as_deref()
        .and_then(|files| file_content(files, &filename));

    let result = build_diff_result(&filename, from_content, to_content, ignore_whitespace);
    Ok(serde_wasm_bindgen::to_value(&result)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `#[wasm_bindgen]` entry points above are exercised by
    /// `tests/web.rs` under `wasm-pack test`: they need a `fetch` and a
    /// `JsValue`, neither of which exists on the host, where constructing a
    /// `JsValue` aborts the process. What is tested here is everything they
    /// are built out of.
    fn file(content: &str) -> FileMapEntry {
        FileMapEntry {
            file_type: FileType::File,
            content: content.to_string(),
        }
    }

    fn dir() -> FileMapEntry {
        FileMapEntry {
            file_type: FileType::Directory,
            content: String::new(),
        }
    }

    /// The cache is keyed per registry, package and version: two registries
    /// serving a package of the same name must not share an entry.
    #[test]
    fn a_cache_key_separates_registry_package_and_version() {
        assert_eq!(cache_key("npm", "left-pad", "1.3.0"), "npm:left-pad:1.3.0");
        assert_ne!(
            cache_key("npm", "requests", "2.0.0"),
            cache_key("pypi", "requests", "2.0.0")
        );
        assert_ne!(
            cache_key("crates", "serde", "1.0.0"),
            cache_key("crates", "serde", "1.0.1")
        );
    }

    /// Scoped npm names contain a slash, which must not be read as a
    /// separator when the key is compared.
    #[test]
    fn a_scoped_package_name_keys_on_its_whole_name() {
        assert_eq!(
            cache_key("npm", "@types/node", "20.1.0"),
            "npm:@types/node:20.1.0"
        );
    }

    #[test]
    fn only_a_file_has_content() {
        let files = HashMap::from([
            ("a.rs".to_string(), file("body")),
            ("src".to_string(), dir()),
        ]);
        assert_eq!(file_content(&files, "a.rs"), Some("body"));
        assert_eq!(file_content(&files, "src"), None);
        assert_eq!(file_content(&files, "missing.rs"), None);
    }

    /// The path is in neither version — a stale link, or a file that only
    /// ever existed as a rename's source. The viewer gets a sentence, not a
    /// diff, so it does not try to render one.
    #[test]
    fn a_file_in_neither_version_is_not_a_diff() {
        let result = build_diff_result("gone.rs", None, None, false);
        assert!(!result.is_diff);
        assert_eq!(result.data, "File not present in either version.");
    }

    #[test]
    fn an_added_file_is_rendered_against_dev_null() {
        let result = build_diff_result("a.rs", None, Some("one\ntwo"), false);
        assert!(result.is_diff);
        assert_eq!(result.data, "--- /dev/null\n+++ to/a.rs\n+ one\n+ two");
    }

    #[test]
    fn a_removed_file_is_rendered_against_dev_null() {
        let result = build_diff_result("a.rs", Some("one\ntwo"), None, false);
        assert!(result.is_diff);
        assert_eq!(result.data, "--- from/a.rs\n+++ /dev/null\n- one\n- two");
    }

    /// Byte-identical: the file itself, marked as not a diff, so the viewer
    /// renders it as a file rather than as a hunk of all-context lines.
    #[test]
    fn an_unchanged_file_is_returned_as_its_own_content() {
        let result = build_diff_result("a.rs", Some("same\n"), Some("same\n"), false);
        assert!(!result.is_diff);
        assert_eq!(result.data, "same\n");
    }

    #[test]
    fn a_changed_file_is_rendered_as_a_diff() {
        let result = build_diff_result("a.rs", Some("one\n"), Some("two\n"), false);
        assert!(result.is_diff);
        assert_eq!(result.data, "--- from/a.rs\n+++ to/a.rs\n- one\n+ two");
    }

    /// Whitespace-only changes still reach the diff renderer — the file is
    /// not byte-identical — but in `ignore_whitespace` mode every line comes
    /// back as context.
    #[test]
    fn a_reformat_is_all_context_when_whitespace_is_ignored() {
        let from = "fn main() {\n\tlet x=1;\n}\n";
        let to = "fn main() {\n    let x = 1;\n}\n";

        let ignoring = build_diff_result("a.rs", Some(from), Some(to), true);
        assert!(ignoring.is_diff);
        assert!(
            !ignoring
                .data
                .lines()
                .any(|line| line.starts_with('-') && !line.starts_with("---")),
            "no line should read as removed: {}",
            ignoring.data
        );

        let exact = build_diff_result("a.rs", Some(from), Some(to), false);
        assert!(exact.data.contains("- \tlet x=1;"));
    }

    /// A one-line file has no trailing newline to split on; the renderer must
    /// still produce a header and exactly one line.
    #[test]
    fn a_file_without_a_trailing_newline_renders_one_line() {
        let result = build_diff_result("a.rs", None, Some("only"), false);
        assert_eq!(result.data, "--- /dev/null\n+++ to/a.rs\n+ only");
    }
}
