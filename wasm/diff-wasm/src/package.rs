use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};

use flate2::read::GzDecoder;
use js_sys::Uint8Array;
use serde::Deserialize;
use tar::Archive;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Response, Window, WorkerGlobalScope};
use zip::ZipArchive;

use crate::types::{FileMapEntry, FileType};

#[derive(Deserialize)]
struct PyPiResponse {
    urls: Vec<PyPiUrl>,
}

#[derive(Deserialize)]
struct PyPiUrl {
    url: String,
    packagetype: String,
}

pub async fn fetch_and_extract_package(
    registry: &str,
    pkg: &str,
    version: &str,
) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let bytes = match registry {
        "pypi" => fetch_pypi_sdist_bytes(pkg, version).await?,
        _ => {
            let url = build_tarball_url(registry, pkg, version)?;
            fetch_bytes(&url).await?
        }
    };
    if registry == "rubygems" {
        extract_gem_bytes(&bytes)
    } else {
        extract_archive_bytes(&bytes)
    }
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

        "rubygems" => Ok(format!("http://88.198.74.219/api/download?package={pkg}&version={version}&registry=rubygems")),
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

async fn fetch_pypi_sdist_bytes(pkg: &str, version: &str) -> Result<Vec<u8>, JsValue> {
    let metadata_url = format!("https://pypi.org/pypi/{pkg}/{version}/json");
    let metadata_bytes = fetch_bytes(&metadata_url).await?;
    let metadata: PyPiResponse = serde_json::from_slice(&metadata_bytes).map_err(|err| {
        JsValue::from_str(&format!("Failed to parse PyPI metadata: {err}"))
    })?;

    let sdist_url = select_pypi_sdist_url(&metadata.urls)?;
    fetch_bytes(&sdist_url).await
}

fn select_pypi_sdist_url(urls: &[PyPiUrl]) -> Result<String, JsValue> {
    let mut sdist_supported = None;
    let mut sdist_fallback = None;
    let mut wheel_supported = None;
    let mut wheel_fallback = None;

    for entry in urls {
        if entry.packagetype == "sdist" {
            if is_supported_archive_url(&entry.url) {
                if sdist_supported.is_none() {
                    sdist_supported = Some(entry.url.clone());
                }
            } else if sdist_fallback.is_none() {
                sdist_fallback = Some(entry.url.clone());
            }
        } else if entry.packagetype == "bdist_wheel" {
            if is_supported_archive_url(&entry.url) {
                if wheel_supported.is_none() {
                    wheel_supported = Some(entry.url.clone());
                }
            } else if wheel_fallback.is_none() {
                wheel_fallback = Some(entry.url.clone());
            }
        }
    }

    sdist_supported
        .or(wheel_supported)
        .or(sdist_fallback)
        .or(wheel_fallback)
        .ok_or_else(|| JsValue::from_str("No downloadable artifacts found for PyPI package"))
}

fn is_supported_archive_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar")
        || lower.ends_with(".zip")
        || lower.ends_with(".whl")
}

fn extract_gem_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let mut archive = Archive::new(Cursor::new(bytes));
    let entries = archive
        .entries()
        .map_err(|err| JsValue::from_str(&format!("Gem tar parsing failed: {err}")))?;

    let mut data_tar = None;
    let mut aux_files = HashMap::new();

    for entry in entries {
        let mut entry =
            entry.map_err(|err| JsValue::from_str(&format!("Gem tar entry error: {err}")))?;
        let path = entry
            .path()
            .map_err(|err| JsValue::from_str(&format!("Gem tar path error: {err}")))?;

        let path_str = path.to_string_lossy();
        if path_str == "data.tar.gz" || path_str == "data.tar" {
            let mut data_tar_bytes = Vec::new();
            entry
                .read_to_end(&mut data_tar_bytes)
                .map_err(|err| JsValue::from_str(&format!("Failed to read data.tar.gz: {err}")))?;
            data_tar = Some(data_tar_bytes);
        } else if path_str == "metadata.gz" {
            let mut raw = Vec::new();
            entry
                .read_to_end(&mut raw)
                .map_err(|err| JsValue::from_str(&format!("Failed to read metadata.gz: {err}")))?;
            let content = decode_gzip_or_utf8(&raw, "metadata.gz")?;
            aux_files.insert(
                "metadata.yml".to_string(),
                FileMapEntry {
                    file_type: FileType::File,
                    content,
                },
            );
        } else if path_str == "checksums.yaml.gz" || path_str == "checksums.yaml" {
            let mut raw = Vec::new();
            entry.read_to_end(&mut raw).map_err(|err| {
                JsValue::from_str(&format!("Failed to read checksums.yaml: {err}"))
            })?;
            let content = decode_gzip_or_utf8(&raw, "checksums.yaml")?;
            aux_files.insert(
                "checksums.yaml".to_string(),
                FileMapEntry {
                    file_type: FileType::File,
                    content,
                },
            );
        }
    }

    if let Some(data_tar_bytes) = data_tar {
        let mut data_files = extract_archive_bytes(&data_tar_bytes)?;
        data_files.extend(aux_files);
        Ok(data_files)
    } else {
        Err(JsValue::from_str(
            "data.tar.gz or data.tar not found in .gem file",
        ))
    }
}

fn extract_archive_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    if is_gzip(bytes) {
        let mut decoder = GzDecoder::new(bytes);
        let mut decompressed = Vec::new();
        decoder
            .read_to_end(&mut decompressed)
            .map_err(|err| JsValue::from_str(&format!("Gzip decompression failed: {err}")))?;
        return extract_archive_bytes(&decompressed);
    }

    if is_zip(bytes) {
        return parse_zip_bytes(bytes);
    }

    parse_tar_bytes(bytes)
}

fn decode_gzip_or_utf8(bytes: &[u8], label: &str) -> Result<String, JsValue> {
    if is_gzip(bytes) {
        let mut decoder = GzDecoder::new(bytes);
        let mut decompressed = Vec::new();
        decoder
            .read_to_end(&mut decompressed)
            .map_err(|err| JsValue::from_str(&format!("Gzip decompression failed for {label}: {err}")))?;
        Ok(String::from_utf8_lossy(&decompressed).into_owned())
    } else {
        Ok(String::from_utf8_lossy(bytes).into_owned())
    }
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

fn parse_zip_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, JsValue> {
    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|err| JsValue::from_str(&format!("Zip parsing failed: {err}")))?;
    let mut files = HashMap::new();

    for i in 0..archive.len() {
        let mut entry =
            archive.by_index(i).map_err(|err| JsValue::from_str(&format!("Zip entry error: {err}")))?;
        let normalized = normalize_path(entry.name(), entry.is_dir());
        if normalized.is_empty() {
            continue;
        }

        if entry.is_dir() {
            files.insert(
                normalized,
                FileMapEntry {
                    file_type: FileType::Directory,
                    content: String::new(),
                },
            );
        } else {
            let mut contents = Vec::new();
            entry
                .read_to_end(&mut contents)
                .map_err(|err| JsValue::from_str(&format!("Zip read failed: {err}")))?;
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
    let normalized_path = path.replace('\\', "/");
    let mut trimmed = normalized_path.as_str();
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

fn is_gzip(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

fn is_zip(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && ((bytes[0] == 0x50 && bytes[1] == 0x4b && bytes[2] == 0x03 && bytes[3] == 0x04)
            || (bytes[0] == 0x50 && bytes[1] == 0x4b && bytes[2] == 0x05 && bytes[3] == 0x06)
            || (bytes[0] == 0x50 && bytes[1] == 0x4b && bytes[2] == 0x07 && bytes[3] == 0x08))
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
