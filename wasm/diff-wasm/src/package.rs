use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Cursor, Read};

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
    if registry == "go" {
        let bytes = fetch_bytes(&build_go_zip_url(pkg, version)).await?;
        let files =
            extract_archive_bytes_with(&bytes, false).map_err(|err| JsValue::from_str(&err))?;
        return Ok(strip_go_module_root(files, pkg, version));
    }

    let bytes = match registry {
        "pypi" => fetch_pypi_sdist_bytes(pkg, version).await?,
        _ => {
            let url =
                build_tarball_url(registry, pkg, version).map_err(|err| JsValue::from_str(&err))?;
            fetch_bytes(&url).await?
        }
    };
    extract_archive_bytes(&bytes).map_err(|err| JsValue::from_str(&err))
}

/// The module proxy serves lower-cased paths, escaping each uppercase letter as
/// `!` followed by its lowercase form, so `Masterminds` becomes `!masterminds`.
/// Requesting the unescaped path is a 404.
fn escape_go_module_path(pkg: &str) -> String {
    let mut escaped = String::with_capacity(pkg.len());
    for ch in pkg.chars() {
        if ch.is_ascii_uppercase() {
            escaped.push('!');
            escaped.push(ch.to_ascii_lowercase());
        } else {
            escaped.push(ch);
        }
    }
    escaped
}

fn build_go_zip_url(pkg: &str, version: &str) -> String {
    format!(
        "https://proxy.golang.org/{}/@v/{version}.zip",
        escape_go_module_path(pkg)
    )
}

/// Module zips prefix every entry with `<module>@<version>/`. That prefix embeds
/// the version, so the two sides of a diff would share no paths at all and every
/// file would read as removed-then-added. Unlike the other registries the prefix
/// spans several components (`github.com/sirupsen/logrus@v1.9.3/`), which is why
/// `strip_common_root` cannot do the job. Entry names keep the module's real
/// casing, so the unescaped path is the one to strip.
fn strip_go_module_root(
    files: HashMap<String, FileMapEntry>,
    pkg: &str,
    version: &str,
) -> HashMap<String, FileMapEntry> {
    let prefix = format!("{pkg}@{version}/");
    if !files.keys().any(|path| path.starts_with(&prefix)) {
        return strip_common_root(files);
    }

    let mut stripped = HashMap::new();
    for (path, entry) in files {
        if let Some(rest) = path.strip_prefix(&prefix) {
            if !rest.is_empty() {
                stripped.insert(rest.to_string(), entry);
            }
        }
    }

    ensure_directories(&mut stripped);
    stripped
}

fn build_tarball_url(registry: &str, pkg: &str, version: &str) -> Result<String, String> {
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
        _ => Err(format!("Unsupported registry: {registry}")),
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
    let metadata: PyPiResponse = serde_json::from_slice(&metadata_bytes)
        .map_err(|err| JsValue::from_str(&format!("Failed to parse PyPI metadata: {err}")))?;

    let sdist_url = select_pypi_sdist_url(&metadata.urls).map_err(|err| JsValue::from_str(&err))?;
    fetch_bytes(&sdist_url).await
}

fn select_pypi_sdist_url(urls: &[PyPiUrl]) -> Result<String, String> {
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
        .ok_or_else(|| "No downloadable artifacts found for PyPI package".to_string())
}

fn is_supported_archive_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar")
        || lower.ends_with(".zip")
        || lower.ends_with(".whl")
}

/// Every archive shape a registry serves — `.tgz`/`.crate` (gzip'd tar),
/// `.zip`/`.whl`, or a bare tar — to the path → entry map the diff runs on,
/// with a single top-level directory stripped. Pure Rust, so it is also what
/// `examples/bench.rs` times natively.
pub fn extract_archive_bytes(bytes: &[u8]) -> Result<HashMap<String, FileMapEntry>, String> {
    extract_archive_bytes_with(bytes, true)
}

/// How far ahead of the tar parser the gunzip runs. Tar reads its 512-byte
/// headers one at a time; without this each of them would be its own trip
/// into the inflater.
const GUNZIP_READAHEAD: usize = 64 * 1024;

/// The most a byte of deflate can expand to, per the format. Bounds every
/// size an archive *claims* — a gzip trailer, a tar header, a zip directory —
/// so a corrupt or hostile one cannot ask for a buffer the input could never
/// fill. wasm memory never shrinks, so a wild pre-allocation would stay with
/// the page for the rest of the session.
const MAX_DEFLATE_RATIO: usize = 1032;

/// The uncompressed content is copied as few times as the formats allow:
///
/// - a gzip'd tar is streamed straight from the inflater into the tar
///   parser, never materialised as a whole;
/// - a gzip'd zip has to be materialised, because zip is read from its
///   central directory at the end, but into a buffer sized once from the
///   gzip trailer rather than grown from empty;
/// - every entry lands in a buffer sized from its header and becomes a
///   `String` without another copy when it is valid UTF-8, which nearly every
///   file is.
///
/// On an 80 MB package the old path — gunzip into an unsized buffer, each
/// entry into another, then `from_utf8_lossy(..).into_owned()` — was ~7 copies
/// of the content; `tests::COPIES_ALLOWED` pins the budget this has to meet.
fn extract_archive_bytes_with(
    bytes: &[u8],
    strip_root: bool,
) -> Result<HashMap<String, FileMapEntry>, String> {
    if is_gzip(bytes) {
        let size_cap = bytes.len().saturating_mul(MAX_DEFLATE_RATIO);
        let mut decoder = BufReader::with_capacity(GUNZIP_READAHEAD, GzDecoder::new(bytes));
        let head = decoder
            .fill_buf()
            .map_err(|err| format!("Gzip decompression failed: {err}"))?;
        if is_zip(head) {
            let mut decompressed = Vec::with_capacity(gzip_uncompressed_size(bytes).min(size_cap));
            decoder
                .read_to_end(&mut decompressed)
                .map_err(|err| format!("Gzip decompression failed: {err}"))?;
            return parse_zip_bytes(&decompressed, strip_root);
        }
        return parse_tar(decoder, size_cap, strip_root);
    }

    if is_zip(bytes) {
        return parse_zip_bytes(bytes, strip_root);
    }

    parse_tar(bytes, bytes.len(), strip_root)
}

/// The ISIZE trailer: the uncompressed length modulo 2³², which for anything
/// a registry serves is the length. Only a hint for a buffer's capacity, so a
/// wrong one costs a reallocation, never a wrong result.
fn gzip_uncompressed_size(bytes: &[u8]) -> usize {
    match bytes {
        [.., a, b, c, d] => u32::from_le_bytes([*a, *b, *c, *d]) as usize,
        _ => 0,
    }
}

/// A buffer for an entry that says it is `declared` bytes long. `cap` is the
/// most the archive as a whole can hold, so a lying header gets at most that.
fn entry_buffer(declared: u64, cap: usize) -> Vec<u8> {
    let declared = usize::try_from(declared).unwrap_or(usize::MAX);
    Vec::with_capacity(declared.min(cap))
}

/// Owns the bytes when they are UTF-8 — no copy — and renders them lossily
/// only when they are not, exactly as they were always rendered.
fn content_from_bytes(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap_or_else(|err| String::from_utf8_lossy(err.as_bytes()).into_owned())
}

fn file_entry(content: String) -> FileMapEntry {
    FileMapEntry {
        file_type: FileType::File,
        content,
    }
}

fn directory_entry() -> FileMapEntry {
    FileMapEntry {
        file_type: FileType::Directory,
        content: String::new(),
    }
}

fn parse_tar<R: Read>(
    reader: R,
    size_cap: usize,
    strip_root: bool,
) -> Result<HashMap<String, FileMapEntry>, String> {
    let mut archive = Archive::new(reader);
    let mut files = HashMap::new();
    let entries = archive
        .entries()
        .map_err(|err| format!("Tar parsing failed: {err}"))?;

    for entry in entries {
        let mut entry = entry.map_err(|err| format!("Tar entry error: {err}"))?;
        let entry_type = entry.header().entry_type();
        let path = entry
            .path()
            .map_err(|err| format!("Tar path error: {err}"))?;
        let normalized = normalize_path(&path.to_string_lossy(), entry_type.is_dir());
        if normalized.is_empty() {
            continue;
        }

        if entry_type.is_dir() {
            files.insert(normalized, directory_entry());
        } else if entry_type.is_file() {
            let mut contents = entry_buffer(entry.size(), size_cap);
            entry
                .read_to_end(&mut contents)
                .map_err(|err| format!("Tar read failed: {err}"))?;
            files.insert(normalized, file_entry(content_from_bytes(contents)));
        }
    }

    ensure_directories(&mut files);
    Ok(if strip_root {
        strip_common_root(files)
    } else {
        files
    })
}

fn parse_zip_bytes(
    bytes: &[u8],
    strip_root: bool,
) -> Result<HashMap<String, FileMapEntry>, String> {
    let size_cap = bytes.len().saturating_mul(MAX_DEFLATE_RATIO);
    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("Zip parsing failed: {err}"))?;
    let mut files = HashMap::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|err| format!("Zip entry error: {err}"))?;
        let normalized = normalize_path(entry.name(), entry.is_dir());
        if normalized.is_empty() {
            continue;
        }

        if entry.is_dir() {
            files.insert(normalized, directory_entry());
        } else {
            let mut contents = entry_buffer(entry.size(), size_cap);
            entry
                .read_to_end(&mut contents)
                .map_err(|err| format!("Zip read failed: {err}"))?;
            files.insert(normalized, file_entry(content_from_bytes(contents)));
        }
    }

    ensure_directories(&mut files);
    Ok(if strip_root {
        strip_common_root(files)
    } else {
        files
    })
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
                files.insert(current.clone(), directory_entry());
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    use std::io::Write;

    use flate2::write::GzEncoder;
    use flate2::Compression;

    /// Counts every byte the current thread asks the allocator for, so a test
    /// can pin how many times a package's content is copied on its way to the
    /// map — a deterministic figure where a timing would flake. A realloc
    /// counts its new size in full: a growing `Vec` that doubles its way to
    /// `n` bytes has asked for about `2n`, which is the shape being measured.
    struct CountingAllocator;

    thread_local! {
        static REQUESTED: Cell<usize> = const { Cell::new(0) };
    }

    fn record(bytes: usize) {
        // A thread that is being torn down has no counter to update.
        let _ = REQUESTED.try_with(|counter| counter.set(counter.get() + bytes));
    }

    unsafe impl GlobalAlloc for CountingAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            record(layout.size());
            System.alloc(layout)
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            System.dealloc(ptr, layout)
        }

        unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
            record(new_size);
            System.realloc(ptr, layout, new_size)
        }
    }

    #[global_allocator]
    static ALLOCATOR: CountingAllocator = CountingAllocator;

    fn bytes_requested_during<T>(f: impl FnOnce() -> T) -> (T, usize) {
        let before = REQUESTED.with(Cell::get);
        let out = f();
        let after = REQUESTED.with(Cell::get);
        (out, after - before)
    }

    /// Text that deflates like source code does — repetitive, but not so
    /// trivially that the decompressor's cost vanishes.
    fn text(seed: usize, bytes: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes + 64);
        let mut line = 0;
        while out.len() < bytes {
            let _ = writeln!(
                out,
                "let value_{line} = compute({seed}, {});",
                line * 7 % 13
            );
            line += 1;
        }
        out.truncate(bytes);
        out
    }

    /// `(path, bytes)` for a package of `count` files of `size` bytes each,
    /// under one top-level directory the way a registry tarball is laid out.
    fn package(count: usize, size: usize) -> Vec<(String, Vec<u8>)> {
        (0..count)
            .map(|i| (format!("pkg-1.0.0/src/file_{i}.rs"), text(i, size)))
            .collect()
    }

    fn tar_bytes(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, bytes) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, path, bytes.as_slice())
                .unwrap();
        }
        builder.into_inner().unwrap()
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn zip_bytes(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (path, bytes) in entries {
            writer.start_file(path.as_str(), options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn content_bytes(entries: &[(String, Vec<u8>)]) -> usize {
        entries.iter().map(|(_, bytes)| bytes.len()).sum()
    }

    /// What every extracted file must read as: the bytes themselves when they
    /// are UTF-8, and the lossy rendering when they are not.
    fn expected_content(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    fn assert_extracts_exactly(archive: &[u8], entries: &[(String, Vec<u8>)]) {
        let files = extract_archive_bytes(archive).unwrap();
        for (path, bytes) in entries {
            let stripped = path.strip_prefix("pkg-1.0.0/").unwrap();
            let entry = files
                .get(stripped)
                .unwrap_or_else(|| panic!("{stripped} missing from {:?}", files.keys()));
            assert!(matches!(entry.file_type, FileType::File));
            assert_eq!(entry.content, expected_content(bytes), "{stripped}");
        }
        let file_count = files
            .values()
            .filter(|entry| matches!(entry.file_type, FileType::File))
            .count();
        assert_eq!(file_count, entries.len());
    }

    /// Valid UTF-8, invalid UTF-8, and an empty file, in every archive shape a
    /// registry serves plus the bare tar and gzipped zip the extractor also
    /// accepts. Invalid bytes must come out as the lossy rendering they always
    /// have — the fast path must not change what a reader sees.
    fn mixed_entries() -> Vec<(String, Vec<u8>)> {
        vec![
            ("pkg-1.0.0/src/lib.rs".to_string(), text(1, 3000)),
            (
                "pkg-1.0.0/README.md".to_string(),
                "# héllo wörld ✓\n".as_bytes().to_vec(),
            ),
            (
                "pkg-1.0.0/data.bin".to_string(),
                vec![0x66, 0x6f, 0xff, 0xfe, 0x6f, 0x80, 0x0a],
            ),
            ("pkg-1.0.0/empty".to_string(), Vec::new()),
            ("pkg-1.0.0/src/exact_block.rs".to_string(), text(2, 512)),
            (
                "pkg-1.0.0/src/truncated_utf8.rs".to_string(),
                "abc€".as_bytes()[..5].to_vec(),
            ),
        ]
    }

    #[test]
    fn a_gzipped_tar_extracts_every_file_byte_for_byte() {
        let entries = mixed_entries();
        assert_extracts_exactly(&gzip(&tar_bytes(&entries)), &entries);
    }

    #[test]
    fn a_bare_tar_extracts_every_file_byte_for_byte() {
        let entries = mixed_entries();
        assert_extracts_exactly(&tar_bytes(&entries), &entries);
    }

    #[test]
    fn a_zip_extracts_every_file_byte_for_byte() {
        let entries = mixed_entries();
        assert_extracts_exactly(&zip_bytes(&entries), &entries);
    }

    #[test]
    fn a_gzipped_zip_extracts_every_file_byte_for_byte() {
        let entries = mixed_entries();
        assert_extracts_exactly(&gzip(&zip_bytes(&entries)), &entries);
    }

    #[test]
    fn invalid_utf8_is_rendered_lossily_not_dropped() {
        let entries = mixed_entries();
        let files = extract_archive_bytes(&gzip(&tar_bytes(&entries))).unwrap();
        assert_eq!(files["data.bin"].content, "fo\u{FFFD}\u{FFFD}o\u{FFFD}\n");
        assert_eq!(files["src/truncated_utf8.rs"].content, "abc\u{FFFD}");
    }

    #[test]
    fn a_corrupt_gzip_stream_is_an_error_not_a_partial_package() {
        let mut archive = gzip(&tar_bytes(&mixed_entries()));
        let cut = archive.len() / 2;
        archive.truncate(cut);
        assert!(extract_archive_bytes(&archive).is_err());
    }

    /// The budget every archive shape has to meet: each byte of file content
    /// is copied into its `String` about once. Before this was pinned, a
    /// gzipped tar cost ~5× — the gunzip buffer doubling its way up, each
    /// entry's buffer doubling its way up again, and a third copy for
    /// `from_utf8_lossy(..).into_owned()` on bytes that were valid all along —
    /// and on an 80 MB package that is the difference between a 100 MB and a
    /// 400 MB high-water mark in a wasm heap that never shrinks.
    const COPIES_ALLOWED: usize = 2;

    fn assert_within_copy_budget(archive: &[u8], entries: &[(String, Vec<u8>)], shape: &str) {
        let (files, requested) = bytes_requested_during(|| extract_archive_bytes(archive).unwrap());
        let content = content_bytes(entries);
        assert!(
            files.len() > entries.len(),
            "directories are in the map too"
        );
        assert!(
            requested < COPIES_ALLOWED * content,
            "{shape}: extracting {content} bytes of content requested {requested} bytes \
             from the allocator ({:.2} copies); the budget is {COPIES_ALLOWED}",
            requested as f64 / content as f64
        );
    }

    #[test]
    fn extracting_a_gzipped_tar_copies_each_byte_of_content_about_once() {
        let entries = package(48, 96 * 1024);
        assert_within_copy_budget(&gzip(&tar_bytes(&entries)), &entries, "gzipped tar");
    }

    #[test]
    fn extracting_a_bare_tar_copies_each_byte_of_content_about_once() {
        let entries = package(48, 96 * 1024);
        assert_within_copy_budget(&tar_bytes(&entries), &entries, "bare tar");
    }

    #[test]
    fn extracting_a_zip_copies_each_byte_of_content_about_once() {
        let entries = package(48, 96 * 1024);
        assert_within_copy_budget(&zip_bytes(&entries), &entries, "zip");
    }

    // ---- URL construction -------------------------------------------------

    #[test]
    fn a_go_module_path_escapes_every_uppercase_letter() {
        assert_eq!(
            escape_go_module_path("github.com/Masterminds/semver"),
            "github.com/!masterminds/semver"
        );
        assert_eq!(
            escape_go_module_path("github.com/sirupsen/logrus"),
            "github.com/sirupsen/logrus"
        );
        assert_eq!(escape_go_module_path("ABC"), "!a!b!c");
        assert_eq!(escape_go_module_path(""), "");
    }

    /// Non-ASCII uppercase is left alone: the proxy's escaping rule is defined
    /// over ASCII, and lower-casing anything else would invent a path.
    #[test]
    fn go_module_escaping_leaves_non_ascii_alone() {
        assert_eq!(
            escape_go_module_path("gopkg.in/Ünicode"),
            "gopkg.in/Ünicode"
        );
    }

    #[test]
    fn a_go_zip_url_carries_the_escaped_path_and_the_version() {
        assert_eq!(
            build_go_zip_url("github.com/Masterminds/semver", "v3.2.1"),
            "https://proxy.golang.org/github.com/!masterminds/semver/@v/v3.2.1.zip"
        );
    }

    #[test]
    fn an_npm_tarball_url_uses_the_unscoped_name_for_the_file() {
        assert_eq!(
            build_tarball_url("npm", "left-pad", "1.3.0").unwrap(),
            "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"
        );
        assert_eq!(
            build_tarball_url("npm", "@types/node", "20.1.0").unwrap(),
            "https://registry.npmjs.org/@types/node/-/node-20.1.0.tgz"
        );
    }

    #[test]
    fn a_crates_tarball_url_repeats_the_name_in_the_file() {
        assert_eq!(
            build_tarball_url("crates", "serde", "1.0.200").unwrap(),
            "https://static.crates.io/crates/serde/serde-1.0.200.crate"
        );
    }

    #[test]
    fn an_unknown_registry_has_no_tarball_url() {
        assert_eq!(
            build_tarball_url("maven", "guava", "33.0.0").unwrap_err(),
            "Unsupported registry: maven"
        );
    }

    // ---- PyPI artifact selection ------------------------------------------

    fn pypi(packagetype: &str, url: &str) -> PyPiUrl {
        PyPiUrl {
            url: url.to_string(),
            packagetype: packagetype.to_string(),
        }
    }

    #[test]
    fn every_shape_the_extractor_understands_is_a_supported_archive_url() {
        for url in [
            "https://x/a.tar.gz",
            "https://x/a.TGZ",
            "https://x/a.tar",
            "https://x/a.zip",
            "https://x/a.whl",
        ] {
            assert!(is_supported_archive_url(url), "{url}");
        }
        for url in [
            "https://x/a.tar.bz2",
            "https://x/a.exe",
            "https://x/a.egg",
            "https://x/a",
        ] {
            assert!(!is_supported_archive_url(url), "{url}");
        }
    }

    #[test]
    fn a_supported_sdist_outranks_everything_else() {
        let urls = [
            pypi("bdist_wheel", "https://x/a.whl"),
            pypi("sdist", "https://x/a.tar.bz2"),
            pypi("sdist", "https://x/a.tar.gz"),
        ];
        assert_eq!(select_pypi_sdist_url(&urls).unwrap(), "https://x/a.tar.gz");
    }

    #[test]
    fn a_supported_wheel_beats_an_sdist_the_extractor_cannot_open() {
        let urls = [
            pypi("sdist", "https://x/a.tar.bz2"),
            pypi("bdist_wheel", "https://x/a.whl"),
        ];
        assert_eq!(select_pypi_sdist_url(&urls).unwrap(), "https://x/a.whl");
    }

    /// Nothing supported on offer: the sdist is still the better guess, and
    /// the extractor gets to be the one that says no.
    #[test]
    fn an_unsupported_sdist_is_the_fallback_before_an_unsupported_wheel() {
        let urls = [
            pypi("bdist_wheel", "https://x/a.egg"),
            pypi("sdist", "https://x/a.tar.bz2"),
        ];
        assert_eq!(select_pypi_sdist_url(&urls).unwrap(), "https://x/a.tar.bz2");
    }

    #[test]
    fn the_first_candidate_of_a_rank_wins() {
        let urls = [
            pypi("sdist", "https://x/first.tar.gz"),
            pypi("sdist", "https://x/second.tar.gz"),
        ];
        assert_eq!(
            select_pypi_sdist_url(&urls).unwrap(),
            "https://x/first.tar.gz"
        );
    }

    #[test]
    fn a_release_with_no_usable_artifact_is_an_error() {
        assert_eq!(
            select_pypi_sdist_url(&[]).unwrap_err(),
            "No downloadable artifacts found for PyPI package"
        );
        // `bdist_egg` is neither of the two packagetypes considered.
        assert!(select_pypi_sdist_url(&[pypi("bdist_egg", "https://x/a.zip")]).is_err());
    }

    // ---- format sniffing --------------------------------------------------

    #[test]
    fn gzip_is_recognised_by_its_two_magic_bytes() {
        assert!(is_gzip(&[0x1f, 0x8b, 0x08, 0x00]));
        assert!(!is_gzip(&[0x1f]));
        assert!(!is_gzip(&[]));
        assert!(!is_gzip(&[0x1f, 0x8c]));
    }

    /// All three local-header signatures, because a zip that was streamed or
    /// spanned carries one of the other two.
    #[test]
    fn zip_is_recognised_by_any_of_its_signatures() {
        assert!(is_zip(b"PK\x03\x04"));
        assert!(is_zip(b"PK\x05\x06"));
        assert!(is_zip(b"PK\x07\x08"));
        assert!(!is_zip(b"PK\x01\x02"));
        assert!(!is_zip(b"PK\x03"));
        assert!(!is_zip(&[]));
    }

    #[test]
    fn the_gzip_trailer_is_read_as_the_uncompressed_length() {
        let payload = text(0, 5000);
        assert_eq!(gzip_uncompressed_size(&gzip(&payload)), payload.len());
        // Too short to hold a trailer at all.
        assert_eq!(gzip_uncompressed_size(&[0x1f, 0x8b, 0x08]), 0);
    }

    // ---- buffers and content ----------------------------------------------

    #[test]
    fn an_entry_buffer_is_sized_from_its_header_but_capped_by_the_archive() {
        assert_eq!(entry_buffer(1024, 4096).capacity(), 1024);
        assert_eq!(entry_buffer(u64::MAX, 4096).capacity(), 4096);
        assert_eq!(entry_buffer(0, 4096).capacity(), 0);
    }

    #[test]
    fn utf8_content_is_taken_as_is_and_invalid_bytes_are_rendered_lossily() {
        assert_eq!(content_from_bytes("héllo".as_bytes().to_vec()), "héllo");
        assert_eq!(content_from_bytes(vec![0x66, 0xff, 0x6f]), "f\u{FFFD}o");
        assert_eq!(content_from_bytes(Vec::new()), "");
    }

    #[test]
    fn a_file_entry_keeps_its_content_and_a_directory_entry_has_none() {
        let file = file_entry("body".to_string());
        assert!(matches!(file.file_type, FileType::File));
        assert_eq!(file.content, "body");

        let dir = directory_entry();
        assert!(matches!(dir.file_type, FileType::Directory));
        assert_eq!(dir.content, "");
    }

    // ---- path normalisation -----------------------------------------------

    #[test]
    fn a_path_is_normalised_to_forward_slashes_without_a_leading_dot_or_root() {
        assert_eq!(normalize_path("src\\lib.rs", false), "src/lib.rs");
        assert_eq!(normalize_path("./src/lib.rs", false), "src/lib.rs");
        assert_eq!(normalize_path("././src/lib.rs", false), "src/lib.rs");
        assert_eq!(normalize_path("/src/lib.rs", false), "src/lib.rs");
    }

    /// A directory entry arrives with a trailing slash; the map keys it
    /// without one, so it is the same string a child's parent walk produces.
    #[test]
    fn a_directory_loses_its_trailing_slash_and_a_file_keeps_its_name() {
        assert_eq!(normalize_path("src/", true), "src");
        assert_eq!(normalize_path("src///", true), "src");
        assert_eq!(normalize_path("weird/name/", false), "weird/name/");
    }

    #[test]
    fn a_path_that_names_nothing_normalises_to_the_empty_string() {
        assert_eq!(normalize_path("", false), "");
        assert_eq!(normalize_path(".", false), "");
        assert_eq!(normalize_path("./", true), "");
        assert_eq!(normalize_path("/", true), "");
    }

    // ---- directory synthesis and root stripping ---------------------------

    fn map(entries: &[(&str, FileMapEntry)]) -> HashMap<String, FileMapEntry> {
        entries
            .iter()
            .map(|(path, entry)| (path.to_string(), entry.clone()))
            .collect()
    }

    fn sorted_keys(files: &HashMap<String, FileMapEntry>) -> Vec<String> {
        let mut keys: Vec<String> = files.keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn every_ancestor_of_a_file_becomes_a_directory_entry() {
        let mut files = map(&[("a/b/c/file.rs", file_entry("x".to_string()))]);
        ensure_directories(&mut files);
        assert_eq!(sorted_keys(&files), ["a", "a/b", "a/b/c", "a/b/c/file.rs"]);
        for dir in ["a", "a/b", "a/b/c"] {
            assert!(matches!(files[dir].file_type, FileType::Directory));
        }
    }

    /// The synthesised walk must not overwrite an entry that is already there.
    #[test]
    fn ensuring_directories_leaves_existing_entries_alone() {
        let mut files = map(&[
            ("a", directory_entry()),
            ("a/file.rs", file_entry("body".to_string())),
        ]);
        ensure_directories(&mut files);
        assert_eq!(files["a/file.rs"].content, "body");
        assert!(matches!(files["a/file.rs"].file_type, FileType::File));
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn a_single_top_level_directory_is_stripped() {
        let files = map(&[
            ("pkg-1.0.0", directory_entry()),
            ("pkg-1.0.0/src", directory_entry()),
            ("pkg-1.0.0/src/lib.rs", file_entry("x".to_string())),
        ]);
        assert_eq!(
            sorted_keys(&strip_common_root(files)),
            ["src", "src/lib.rs"]
        );
    }

    #[test]
    fn two_top_level_entries_keep_their_root() {
        let files = map(&[
            ("a", directory_entry()),
            ("a/lib.rs", file_entry("x".to_string())),
            ("b", directory_entry()),
        ]);
        assert_eq!(
            sorted_keys(&strip_common_root(files)),
            ["a", "a/lib.rs", "b"]
        );
    }

    /// A lone top-level *file* is not a wrapper directory — stripping it would
    /// leave nothing behind.
    #[test]
    fn a_lone_top_level_file_is_not_stripped() {
        let files = map(&[("README.md", file_entry("x".to_string()))]);
        assert_eq!(sorted_keys(&strip_common_root(files)), ["README.md"]);
    }

    #[test]
    fn a_root_with_nothing_under_it_is_kept() {
        let files = map(&[("pkg-1.0.0", directory_entry())]);
        assert_eq!(sorted_keys(&strip_common_root(files)), ["pkg-1.0.0"]);
    }

    #[test]
    fn an_empty_map_survives_root_stripping() {
        assert!(strip_common_root(HashMap::new()).is_empty());
    }

    // ---- the Go module prefix ---------------------------------------------

    #[test]
    fn a_go_module_root_is_stripped_prefix_and_all() {
        let files = map(&[
            ("github.com/x/y@v1.2.3", directory_entry()),
            (
                "github.com/x/y@v1.2.3/go.mod",
                file_entry("module x".to_string()),
            ),
            (
                "github.com/x/y@v1.2.3/internal/z.go",
                file_entry("package z".to_string()),
            ),
        ]);
        let stripped = strip_go_module_root(files, "github.com/x/y", "v1.2.3");
        assert_eq!(
            sorted_keys(&stripped),
            ["go.mod", "internal", "internal/z.go"]
        );
        assert!(matches!(
            stripped["internal"].file_type,
            FileType::Directory
        ));
    }

    /// No entry carries the `<module>@<version>/` prefix — a zip laid out some
    /// other way falls back to the ordinary single-root strip.
    #[test]
    fn a_zip_without_the_module_prefix_falls_back_to_the_common_root() {
        let files = map(&[
            ("pkg", directory_entry()),
            ("pkg/main.go", file_entry("package main".to_string())),
        ]);
        let stripped = strip_go_module_root(files, "github.com/x/y", "v1.2.3");
        assert_eq!(sorted_keys(&stripped), ["main.go"]);
    }

    // ---- extraction round-trips -------------------------------------------

    /// What the Go path asks for: the module prefix is stripped afterwards, so
    /// extraction must not have taken the first component off already.
    #[test]
    fn extraction_can_be_asked_to_keep_the_top_level_directory() {
        let entries = vec![("pkg-1.0.0/src/lib.rs".to_string(), text(1, 128))];
        let files = extract_archive_bytes_with(&tar_bytes(&entries), false).unwrap();
        assert_eq!(
            sorted_keys(&files),
            ["pkg-1.0.0", "pkg-1.0.0/src", "pkg-1.0.0/src/lib.rs"]
        );
    }

    #[test]
    fn a_tar_directory_entry_becomes_a_directory_in_the_map() {
        let mut builder = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_entry_type(tar::EntryType::Directory);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "pkg-1.0.0/docs/", &[][..])
            .unwrap();

        let mut file_header = tar::Header::new_gnu();
        file_header.set_size(2);
        file_header.set_mode(0o644);
        file_header.set_cksum();
        builder
            .append_data(&mut file_header, "pkg-1.0.0/a.rs", &b"hi"[..])
            .unwrap();

        let files = extract_archive_bytes(&builder.into_inner().unwrap()).unwrap();
        assert!(matches!(files["docs"].file_type, FileType::Directory));
        assert_eq!(files["a.rs"].content, "hi");
    }

    #[test]
    fn a_zip_directory_entry_becomes_a_directory_in_the_map() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        writer.add_directory("pkg-1.0.0/docs/", options).unwrap();
        writer.start_file("pkg-1.0.0/a.rs", options).unwrap();
        writer.write_all(b"hi").unwrap();
        let archive = writer.finish().unwrap().into_inner();

        let files = extract_archive_bytes(&archive).unwrap();
        assert!(matches!(files["docs"].file_type, FileType::Directory));
        assert_eq!(files["a.rs"].content, "hi");
    }

    #[test]
    fn bytes_that_are_neither_gzip_nor_zip_nor_tar_are_an_error() {
        assert!(extract_archive_bytes(b"not an archive at all").is_err());
    }

    #[test]
    fn a_corrupt_zip_central_directory_is_an_error() {
        let mut archive = zip_bytes(&mixed_entries());
        let len = archive.len();
        archive.truncate(len - 8);
        assert!(extract_archive_bytes(&archive).is_err());
    }
}
