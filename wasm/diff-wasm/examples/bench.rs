//! Times extraction and the diff tree over two local archives, natively.
//!
//! ```text
//! cargo run --release --example bench -- <from-archive> <to-archive> [--ignore-whitespace] [--runs N]
//! ```
//!
//! Any archive shape the registries serve works: a `.crate` or `.tgz`
//! (gzip'd tar), a `.zip` or `.whl`, or a bare tar. Fetch one with `curl`
//! from the URL `package.rs` builds for the registry.
//!
//! Prints, per run, how long each package took to extract and how long the
//! tree took to build, then the medians, then a fingerprint of the tree —
//! every node's path, status, `oldPath` and counts, hashed in tree order.
//! Two builds that print the same fingerprint built the same tree, which is
//! the no-regression check a performance change needs alongside its numbers.
//! One caveat: a file whose search runs past the deadline in `core.rs` is
//! cut where the clock says, so on a pair with such a file two runs can
//! build two trees and the determinism check below fires. That is the
//! deadline, not the builder; no pair in #148 reaches it natively.
//!
//! Numbers here are native numbers. They rank Rust-side changes against each
//! other without a browser in the loop; they are not the wasm figures the
//! issues ask for, which come from the recipe in #148. In particular a
//! `[profile.release]` change moves native and wasm by different amounts.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use diff_wasm::{build_diff_tree, extract_archive_bytes, DiffFileEntry, FileType};

/// What `diff.worker.ts` passes; the tree must be the one the page sees.
const SIMILARITY_THRESHOLD: f64 = 0.75;

struct Args {
    from: String,
    to: String,
    ignore_whitespace: bool,
    runs: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut ignore_whitespace = false;
    let mut runs = 5;
    let mut argv = std::env::args().skip(1);
    while let Some(arg) = argv.next() {
        match arg.as_str() {
            "--ignore-whitespace" => ignore_whitespace = true,
            "--runs" => {
                runs = argv
                    .next()
                    .and_then(|n| n.parse().ok())
                    .filter(|n| *n > 0)
                    .ok_or("--runs takes a positive integer")?;
            }
            other if other.starts_with("--") => return Err(format!("unknown flag {other}")),
            _ => positional.push(arg),
        }
    }
    match positional.as_slice() {
        [from, to] => Ok(Args {
            from: from.clone(),
            to: to.clone(),
            ignore_whitespace,
            runs,
        }),
        _ => Err("usage: bench <from-archive> <to-archive> [--ignore-whitespace] [--runs N]".into()),
    }
}

fn median(samples: &mut [Duration]) -> Duration {
    samples.sort();
    samples[samples.len() / 2]
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn fingerprint(node: &DiffFileEntry, hasher: &mut DefaultHasher) {
    node.path.hash(hasher);
    node.old_path.hash(hasher);
    format!("{:?}", node.status).hash(hasher);
    node.added.hash(hasher);
    node.removed.hash(hasher);
    for child in node.children.iter().flatten() {
        fingerprint(child, hasher);
    }
}

fn count_files(node: &DiffFileEntry) -> usize {
    match node.file_type {
        FileType::File => 1,
        FileType::Directory => node.children.iter().flatten().map(count_files).sum(),
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let from_bytes = std::fs::read(&args.from).map_err(|e| format!("{}: {e}", args.from))?;
    let to_bytes = std::fs::read(&args.to).map_err(|e| format!("{}: {e}", args.to))?;

    println!(
        "from {} ({} bytes)\nto   {} ({} bytes)\nignore_whitespace={} runs={}\n",
        args.from,
        from_bytes.len(),
        args.to,
        to_bytes.len(),
        args.ignore_whitespace,
        args.runs
    );

    let mut extract_from = Vec::with_capacity(args.runs);
    let mut extract_to = Vec::with_capacity(args.runs);
    let mut diff = Vec::with_capacity(args.runs);
    let mut last_fingerprint = None;
    let mut file_counts = (0, 0, 0);

    for run in 1..=args.runs {
        let t = Instant::now();
        let from_files = extract_archive_bytes(&from_bytes)?;
        let t_from = t.elapsed();

        let t = Instant::now();
        let to_files = extract_archive_bytes(&to_bytes)?;
        let t_to = t.elapsed();

        file_counts.0 = from_files.len();
        file_counts.1 = to_files.len();

        let t = Instant::now();
        let tree = build_diff_tree(
            &from_files,
            &to_files,
            SIMILARITY_THRESHOLD,
            args.ignore_whitespace,
        );
        let t_diff = t.elapsed();

        let mut hasher = DefaultHasher::new();
        fingerprint(&tree, &mut hasher);
        let fp = hasher.finish();
        if let Some(previous) = last_fingerprint {
            if previous != fp {
                return Err(format!(
                    "run {run} built a different tree ({previous:016x} then {fp:016x}); the builder is not deterministic"
                ));
            }
        }
        last_fingerprint = Some(fp);
        file_counts.2 = count_files(&tree);

        println!(
            "run {run}: extract from {:8.1} ms | extract to {:8.1} ms | diff {:8.1} ms",
            ms(t_from),
            ms(t_to),
            ms(t_diff)
        );
        extract_from.push(t_from);
        extract_to.push(t_to);
        diff.push(t_diff);
    }

    println!(
        "\nentries: {} from, {} to; {} files in the tree",
        file_counts.0, file_counts.1, file_counts.2
    );
    println!(
        "median: extract from {:8.1} ms | extract to {:8.1} ms | extract both {:8.1} ms | diff {:8.1} ms",
        ms(median(&mut extract_from)),
        ms(median(&mut extract_to)),
        ms(median(&mut extract_from) + median(&mut extract_to)),
        ms(median(&mut diff))
    );
    println!("fingerprint: {:016x}", last_fingerprint.unwrap_or(0));
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("bench: {err}");
            ExitCode::FAILURE
        }
    }
}
