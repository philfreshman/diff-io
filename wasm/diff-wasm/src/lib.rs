mod types;
mod core;
mod package;
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use serde::Serialize;
use crate::types::FileMapEntry;

#[derive(Clone)]
struct ActiveDiff {
    from_key: String,
    to_key: String,
}

thread_local! {
    static EXTRACTION_CACHE: RefCell<HashMap<String, HashMap<String, FileMapEntry>>> =
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
) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let key = cache_key(registry, pkg, version);
    if let Some(cached) = EXTRACTION_CACHE.with(|cache| cache.borrow().get(&key).cloned()) {
        return Ok(cached);
    }

    let files = package::fetch_and_extract_package(registry, pkg, version).await?;
    EXTRACTION_CACHE.with(|cache| {
        cache.borrow_mut().insert(key, files.clone());
    });
    Ok(files)
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffResult {
    data: String,
    is_diff: bool,
}

fn build_diff_result(filename: &str, from_content: Option<&str>, to_content: Option<&str>) -> DiffResult {
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
                    data: core::get_diff_content(filename, from, to),
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
) -> Result<JsValue, JsValue> {
    let from_files = get_or_fetch_package(&registry, &pkg, &from).await?;
    let to_files = get_or_fetch_package(&registry, &pkg, &to).await?;
    let tree = core::build_diff_tree(from_files, to_files, similarity_threshold);

    let from_key = cache_key(&registry, &pkg, &from);
    let to_key = cache_key(&registry, &pkg, &to);
    ACTIVE_DIFF.with(|state| {
        *state.borrow_mut() = Some(ActiveDiff { from_key, to_key });
    });

    Ok(serde_wasm_bindgen::to_value(&tree)?)
}

#[wasm_bindgen]
pub fn get_diff_for_path(filename: String, old_path: Option<String>) -> Result<JsValue, JsValue> {
    let active = ACTIVE_DIFF
        .with(|state| state.borrow().clone())
        .ok_or_else(|| JsValue::from_str("No active diff context"))?;
    let from_key = active.from_key;
    let to_key = active.to_key;

    let from_path = old_path.as_deref().unwrap_or(&filename);
    let (from_content, to_content) = EXTRACTION_CACHE.with(|cache| {
        let cache = cache.borrow();
        let from_content = cache
            .get(&from_key)
            .and_then(|files| files.get(from_path))
            .and_then(|entry| match entry.file_type {
                crate::types::FileType::File => Some(entry.content.as_str()),
                crate::types::FileType::Directory => None,
            });
        let to_content = cache
            .get(&to_key)
            .and_then(|files| files.get(&filename))
            .and_then(|entry| match entry.file_type {
                crate::types::FileType::File => Some(entry.content.as_str()),
                crate::types::FileType::Directory => None,
            });
        (from_content.map(str::to_string), to_content.map(str::to_string))
    });

    let result = build_diff_result(
        &filename,
        from_content.as_deref(),
        to_content.as_deref(),
    );
    Ok(serde_wasm_bindgen::to_value(&result)?)
}
