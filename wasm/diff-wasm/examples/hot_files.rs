//! Times the tree pass's per-file diff, file by file, over two local
//! archives, natively — the tail of what `bench` reports as one number.
//!
//! ```text
//! cargo run --release --example hot_files -- <from-archive> <to-archive> [--top N] [--ignore-whitespace]
//! ```
//!
//! Every file present in both packages with different content is diffed the
//! way `count_diff` diffs it, and the slowest `N` (default 10) are printed
//! with their line counts, their `+`/`−` and the time the diff took, then
//! the total across all of them. Renamed files are not paired here — the
//! tree pass diffs those too, but a rename is a candidate the pass has
//! already found cheap.
//!
//! Numbers here are native numbers, as in `bench`: they say which file is
//! the long pole and by how much, not what the browser will wait.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use diff_wasm::{count_diff_lines, extract_archive_bytes, FileType};

struct Args {
    from: String,
    to: String,
    ignore_whitespace: bool,
    top: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut ignore_whitespace = false;
    let mut top = 10;
    let mut argv = std::env::args().skip(1);
    while let Some(arg) = argv.next() {
        match arg.as_str() {
            "--ignore-whitespace" => ignore_whitespace = true,
            "--top" => {
                top = argv
                    .next()
                    .and_then(|n| n.parse().ok())
                    .filter(|n| *n > 0)
                    .ok_or("--top takes a positive integer")?;
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
            top,
        }),
        _ => Err("usage: hot_files <from-archive> <to-archive> [--top N] [--ignore-whitespace]".into()),
    }
}

struct Sample {
    path: String,
    from_lines: usize,
    to_lines: usize,
    added: u32,
    removed: u32,
    elapsed: Duration,
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let from_bytes = std::fs::read(&args.from).map_err(|e| format!("{}: {e}", args.from))?;
    let to_bytes = std::fs::read(&args.to).map_err(|e| format!("{}: {e}", args.to))?;
    let from_files = extract_archive_bytes(&from_bytes)?;
    let to_files = extract_archive_bytes(&to_bytes)?;

    let mut samples = Vec::new();
    let mut identical = 0usize;
    for (path, from_entry) in &from_files {
        if !matches!(from_entry.file_type, FileType::File) {
            continue;
        }
        let Some(to_entry) = to_files.get(path) else {
            continue;
        };
        if !matches!(to_entry.file_type, FileType::File) {
            continue;
        }
        if from_entry.content == to_entry.content {
            identical += 1;
            continue;
        }
        let t = Instant::now();
        let (added, removed) =
            count_diff_lines(&from_entry.content, &to_entry.content, args.ignore_whitespace);
        let elapsed = t.elapsed();
        samples.push(Sample {
            path: path.clone(),
            from_lines: from_entry.content.lines().count(),
            to_lines: to_entry.content.lines().count(),
            added,
            removed,
            elapsed,
        });
    }

    let total: Duration = samples.iter().map(|s| s.elapsed).sum();
    samples.sort_by(|a, b| b.elapsed.cmp(&a.elapsed));

    println!(
        "{} files diffed, {} byte-identical; ignore_whitespace={}\n",
        samples.len(),
        identical,
        args.ignore_whitespace
    );
    println!(
        "{:>10}  {:>8} {:>8}  {:>8} {:>8}  path",
        "ms", "from", "to", "+", "-"
    );
    for s in samples.iter().take(args.top) {
        println!(
            "{:>10.1}  {:>8} {:>8}  {:>8} {:>8}  {}",
            ms(s.elapsed),
            s.from_lines,
            s.to_lines,
            s.added,
            s.removed,
            s.path
        );
    }
    println!("\ntotal {:.1} ms across {} files", ms(total), samples.len());
    if let Some(top) = samples.first() {
        println!(
            "slowest file is {:.1} % of the total",
            100.0 * top.elapsed.as_secs_f64() / total.as_secs_f64().max(1e-9)
        );
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("hot_files: {err}");
            ExitCode::FAILURE
        }
    }
}
