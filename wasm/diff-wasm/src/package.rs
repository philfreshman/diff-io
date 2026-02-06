use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};

use flate2::read::GzDecoder;
use js_sys::Uint8Array;
use tar::Archive;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Response, Window, WorkerGlobalScope};

use crate::types::{FileMapEntry, FileType};

pub async fn fetch_and_extract_package(
    registry: &str,
    pkg: &str,
    version: &str,
) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let url = build_tarball_url(registry, pkg, version)?;
    let bytes = fetch_bytes(&url).await?;
    extract_tarball_bytes(&bytes)
}

fn build_tarball_url(registry: &str, pkg: &str, version: &str) -> Result<String, JsValue> {
    match registry {
        "npm" => {
            let unscoped = pkg.split('/').nth(1).unwrap_or(pkg);
            Ok(format!(
                "https://registry.npmjs.org/{pkg}/-/{unscoped}-{version}.tgz"
            ))
        }
        "crates" => Ok(format!(
            "https://static.crates.io/crates/{pkg}/{pkg}-{version}.crate"
        )),
        _ => Err(JsValue::from_str(&format!(
            "Unsupported registry: {registry}"
        ))),
    }
}

async fn fetch_bytes(url: &str) -> Result<Vec<u8>, JsValue> {
    let fetch_promise = fetch_with_str(url)?;
    let resp_value = JsFuture::from(fetch_promise).await?;
    let resp: Response = resp_value.dyn_into()?;
    if !resp.ok() {
        return Err(JsValue::from_str(&format!(
            "Failed to fetch tarball from {url}"
        )));
    }

    let buffer = JsFuture::from(resp.array_buffer()?).await?;
    let array = Uint8Array::new(&buffer);
    let mut bytes = vec![0; array.length() as usize];
    array.copy_to(&mut bytes);
    Ok(bytes)
}

fn fetch_with_str(url: &str) -> Result<js_sys::Promise, JsValue> {
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<Window>() {
        Ok(window.fetch_with_str(url))
    } else if let Some(worker) = global.dyn_ref::<WorkerGlobalScope>() {
        Ok(worker.fetch_with_str(url))
    } else {
        Err(JsValue::from_str("Global scope does not support fetch"))
    }
}

fn extract_tarball_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let mut decoder = GzDecoder::new(bytes);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|err| JsValue::from_str(&format!("Gzip decompression failed: {err}")))?;
    parse_tar_bytes(&decompressed)
}

fn parse_tar_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let mut archive = Archive::new(Cursor::new(bytes));
    let mut files = HashMap::new();
    let entries = archive
        .entries()
        .map_err(|err| JsValue::from_str(&format!("Tar parsing failed: {err}")))?;

    for entry in entries {
        let mut entry = entry.map_err(|err| JsValue::from_str(&format!("Tar entry error: {err}")))?;
        let entry_type = entry.header().entry_type();
        let path = entry
            .path()
            .map_err(|err| JsValue::from_str(&format!("Tar path error: {err}")))?;
        let normalized = normalize_path(&path.to_string_lossy(), entry_type.is_dir());
        if normalized.is_empty() {
            continue;
        }

        if entry_type.is_dir() {
            files.insert(
                normalized,
                FileMapEntry {
                    file_type: FileType::Directory,
                    content: String::new(),
                },
            );
        } else if entry_type.is_file() {
            let mut contents = Vec::new();
            entry
                .read_to_end(&mut contents)
                .map_err(|err| JsValue::from_str(&format!("Tar read failed: {err}")))?;
            files.insert(
                normalized,
                FileMapEntry {
                    file_type: FileType::File,
                    content: String::from_utf8_lossy(&contents).into_owned(),
                },
            );
        }
    }

    ensure_directories(&mut files);
    Ok(strip_common_root(files))
}

fn normalize_path(path: &str, is_directory: bool) -> String {
    let mut trimmed = path;
    while trimmed.starts_with("./") {
        trimmed = &trimmed[2..];
    }
    let trimmed = trimmed.trim_start_matches('/');
    if trimmed.is_empty() || trimmed == "." {
        return String::new();
    }
    let normalized = if is_directory {
        trimmed.trim_end_matches('/').to_string()
    } else {
        trimmed.to_string()
    };
    normalized
}

fn ensure_directories(files: &mut HashMap<String, FileMapEntry>) {
    let paths: Vec<String> = files.keys().cloned().collect();
    for path in paths {
        let mut current = String::new();
        for part in path.split('/').take_while(|part| !part.is_empty()) {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(part);
            if !files.contains_key(&current) {
                files.insert(
                    current.clone(),
                    FileMapEntry {
                        file_type: FileType::Directory,
                        content: String::new(),
                    },
                );
            }
        }
    }
}

fn strip_common_root(mut files: HashMap<String, FileMapEntry>) -> HashMap<String, FileMapEntry> {
    let paths: Vec<String> = files.keys().cloned().collect();
    if paths.is_empty() {
        return files;
    }

    let mut top_level = HashSet::new();
    for path in &paths {
        if let Some(first) = path.split('/').next() {
            if !first.is_empty() {
                top_level.insert(first.to_string());
            }
        }
    }

    if top_level.len() != 1 {
        return files;
    }

    let root = top_level.into_iter().next().unwrap();
    match files.get(&root) {
        Some(entry) if matches!(entry.file_type, FileType::Directory) => {}
        _ => return files,
    }

    let prefix = format!("{root}/");
    let mut new_files = HashMap::new();
    let mut has_files = false;
    for path in paths {
        if path == root {
            continue;
        }
        if let Some(new_path) = path.strip_prefix(&prefix) {
            if !new_path.is_empty() {
                if let Some(entry) = files.remove(&path) {
                    new_files.insert(new_path.to_string(), entry);
                    has_files = true;
                }
            }
        }
    }

    if has_files {
        new_files
    } else {
        files
    }
}
