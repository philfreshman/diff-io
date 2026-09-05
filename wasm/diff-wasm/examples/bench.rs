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

#[cfg_attr(test, derive(Debug))]
struct Args {
    from: String,
    to: String,
    ignore_whitespace: bool,
    runs: usize,
}

fn parse_args() -> Result<Args, String> {
    parse_argv(std::env::args().skip(1))
}

/// Split from `parse_args` so the flag grammar can be tested without a
/// process to hand it arguments.
fn parse_argv(argv: impl IntoIterator<Item = String>) -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut ignore_whitespace = false;
    let mut runs = 5;
    let mut argv = argv.into_iter();
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
        _ => {
            Err("usage: bench <from-archive> <to-archive> [--ignore-whitespace] [--runs N]".into())
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use diff_wasm::DiffStatus;

    fn argv(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_string()).collect()
    }

    #[test]
    fn two_archives_are_the_whole_required_grammar() {
        let args = parse_argv(argv(&["from.crate", "to.crate"])).unwrap();
        assert_eq!(
            (args.from.as_str(), args.to.as_str()),
            ("from.crate", "to.crate")
        );
        assert!(!args.ignore_whitespace);
        assert_eq!(args.runs, 5);
    }

    #[test]
    fn the_flags_may_come_before_between_or_after_the_archives() {
        let args = parse_argv(argv(&["--runs", "3", "a", "--ignore-whitespace", "b"])).unwrap();
        assert_eq!((args.from.as_str(), args.to.as_str()), ("a", "b"));
        assert!(args.ignore_whitespace);
        assert_eq!(args.runs, 3);
    }

    /// A run count of zero would median an empty slice, which panics; the
    /// flag rejects it instead.
    #[test]
    fn runs_must_be_a_positive_integer() {
        for bad in [
            argv(&["a", "b", "--runs", "0"]),
            argv(&["a", "b", "--runs", "many"]),
            argv(&["a", "b", "--runs"]),
        ] {
            assert_eq!(
                parse_argv(bad).unwrap_err(),
                "--runs takes a positive integer"
            );
        }
    }

    #[test]
    fn an_unknown_flag_is_not_treated_as_an_archive() {
        assert_eq!(
            parse_argv(argv(&["a", "b", "--fast"])).unwrap_err(),
            "unknown flag --fast"
        );
    }

    #[test]
    fn anything_but_exactly_two_archives_is_a_usage_error() {
        for bad in [argv(&[]), argv(&["a"]), argv(&["a", "b", "c"])] {
            assert!(parse_argv(bad).unwrap_err().starts_with("usage: bench "));
        }
    }

    #[test]
    fn the_median_is_the_middle_sample_whatever_order_they_arrive_in() {
        let mut samples = [30, 10, 20].map(Duration::from_millis);
        assert_eq!(median(&mut samples), Duration::from_millis(20));

        // Even count: the upper of the two middles, which is what
        // `len / 2` indexes.
        let mut even = [10, 20, 30, 40].map(Duration::from_millis);
        assert_eq!(median(&mut even), Duration::from_millis(30));

        let mut one = [7].map(Duration::from_millis);
        assert_eq!(median(&mut one), Duration::from_millis(7));
    }

    #[test]
    fn a_duration_prints_as_milliseconds() {
        assert_eq!(ms(Duration::from_millis(1500)), 1500.0);
        assert_eq!(ms(Duration::from_micros(500)), 0.5);
        assert_eq!(ms(Duration::ZERO), 0.0);
    }

    fn file(path: &str, status: DiffStatus) -> DiffFileEntry {
        DiffFileEntry {
            path: path.to_string(),
            old_path: None,
            file_type: FileType::File,
            status,
            added: Some(1),
            removed: Some(0),
            children: None,
        }
    }

    fn directory(path: &str, children: Vec<DiffFileEntry>) -> DiffFileEntry {
        DiffFileEntry {
            path: path.to_string(),
            old_path: None,
            file_type: FileType::Directory,
            status: DiffStatus::Modified,
            added: Some(1),
            removed: Some(0),
            children: Some(children),
        }
    }

    fn hash(node: &DiffFileEntry) -> u64 {
        let mut hasher = DefaultHasher::new();
        fingerprint(node, &mut hasher);
        hasher.finish()
    }

    /// The whole point of the fingerprint: two builds that agree print the
    /// same number, and any node's path, status, `oldPath` or counts moving
    /// changes it.
    #[test]
    fn the_fingerprint_covers_every_field_it_claims_to() {
        let tree = directory("/", vec![file("a.rs", DiffStatus::Modified)]);
        assert_eq!(
            hash(&tree),
            hash(&directory("/", vec![file("a.rs", DiffStatus::Modified)]))
        );

        assert_ne!(
            hash(&tree),
            hash(&directory("/", vec![file("b.rs", DiffStatus::Modified)]))
        );
        assert_ne!(
            hash(&tree),
            hash(&directory("/", vec![file("a.rs", DiffStatus::Added)]))
        );

        let mut renamed = directory("/", vec![file("a.rs", DiffStatus::Modified)]);
        renamed.children.as_mut().unwrap()[0].old_path = Some("old.rs".to_string());
        assert_ne!(hash(&tree), hash(&renamed));

        let mut recounted = directory("/", vec![file("a.rs", DiffStatus::Modified)]);
        recounted.children.as_mut().unwrap()[0].added = Some(2);
        assert_ne!(hash(&tree), hash(&recounted));
    }

    /// Order matters: the same nodes rearranged are a different tree.
    #[test]
    fn the_fingerprint_is_taken_in_tree_order() {
        let one = directory(
            "/",
            vec![
                file("a.rs", DiffStatus::Added),
                file("b.rs", DiffStatus::Removed),
            ],
        );
        let other = directory(
            "/",
            vec![
                file("b.rs", DiffStatus::Removed),
                file("a.rs", DiffStatus::Added),
            ],
        );
        assert_ne!(hash(&one), hash(&other));
    }

    #[test]
    fn only_files_are_counted_however_deep_they_sit() {
        let tree = directory(
            "/",
            vec![
                file("a.rs", DiffStatus::Added),
                directory("src", vec![file("src/b.rs", DiffStatus::Added)]),
                directory("empty", vec![]),
            ],
        );
        assert_eq!(count_files(&tree), 2);
        assert_eq!(count_files(&directory("/", vec![])), 0);
        assert_eq!(count_files(&file("a.rs", DiffStatus::Added)), 1);
    }
}
