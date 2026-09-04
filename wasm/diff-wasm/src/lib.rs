mod types;
mod core;
mod package;

// The native surface `examples/bench.rs` drives: extraction and the tree
// builder without a fetch in front of them. Nothing here reaches JS — only
// the `#[wasm_bindgen]` functions below do.
pub use crate::core::build_diff_tree;
pub use crate::package::extract_archive_bytes;
pub use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use serde::Serialize;

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
    let tree = core::build_diff_tree(&from_files, &to_files, similarity_threshold, ignore_whitespace);

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
