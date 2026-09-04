use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use similar::{ChangeTag, DiffOp, TextDiff, WhitespaceMode};
use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};

/// `Exact` is Git's default; `IgnoreAll` is its `-w` — every space, tab and
/// line-ending character disregarded. There is no third choice on offer,
/// because `-b` still reads `x=1` and `x = 1` as different lines, which is the
/// very change a reformatted codebase is made of.
pub fn whitespace_mode(ignore_whitespace: bool) -> WhitespaceMode {
    if ignore_whitespace {
        WhitespaceMode::IgnoreAll
    } else {
        WhitespaceMode::Exact
    }
}

/// A diff's `(added, removed, unchanged)` line counts, summed off its op
/// ranges.
///
/// Equivalent to tallying `iter_all_changes()` by tag — `similar` defines that
/// iterator as `ops().flat_map(iter_changes)`, and an op yields exactly
/// `old_len` deletions then `new_len` insertions — but without materializing a
/// `Change` for every line of every `Equal` run just to discard it. An
/// unchanged run costs one summed length, not one step per line.
fn count_op_lines(ops: &[DiffOp]) -> (usize, usize, usize) {
    ops.iter()
        .fold((0, 0, 0), |(added, removed, unchanged), op| match op {
            DiffOp::Insert { new_len, .. } => (added + new_len, removed, unchanged),
            DiffOp::Delete { old_len, .. } => (added, removed + old_len, unchanged),
            DiffOp::Replace {
                old_len, new_len, ..
            } => (added + new_len, removed + old_len, unchanged),
            DiffOp::Equal { len, .. } => (added, removed, unchanged + len),
        })
}

/// Always `diff_lines`, in both modes: `whitespace_mode` reaches no other
/// constructor, and a file must not change how many lines it has because the
/// setting was flipped. It is also what `count_diff` has always used, so the
/// viewer and the tree now count the same lines — splitting on `\n` gave the
/// viewer one phantom blank line at the end of every file that the tree never
/// saw.
pub fn get_diff_content(
    filename: &str,
    from_content: &str,
    to_content: &str,
    ignore_whitespace: bool,
) -> String {
    let diff = TextDiff::configure()
        .whitespace_mode(whitespace_mode(ignore_whitespace))
        .diff_lines(from_content, to_content);
    let mut result = format!("--- from/{}\n+++ to/{}", filename, filename);
    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        result.push('\n');
        result.push_str(sign);
        result.push(' ');
        // Only the `\n`: a `\r` belongs to the line, and reaches the parser
        // exactly as it did when the lines were split by hand.
        let value = change.value();
        result.push_str(value.strip_suffix('\n').unwrap_or(value));
    }
    result
}

/// Borrows both packages: they live in the extraction cache for the rest of
/// the session, and the tree only reads them. Owning them here meant a copy
/// of every file's content per package per diff — 80 MB each on a large
/// crate — in a wasm heap that never gives memory back.
pub struct DiffTreeBuilder<'a> {
    from_files: &'a HashMap<String, FileMapEntry>,
    to_files: &'a HashMap<String, FileMapEntry>,
    from_file_paths: HashSet<String>,
    to_file_paths: HashSet<String>,
    from_dirs: HashSet<String>,
    to_dirs: HashSet<String>,
    similarity_threshold: f64,
    ignore_whitespace: bool,
}

impl<'a> DiffTreeBuilder<'a> {
    pub fn new(
        from_files: &'a HashMap<String, FileMapEntry>,
        to_files: &'a HashMap<String, FileMapEntry>,
        similarity_threshold: f64,
        ignore_whitespace: bool,
    ) -> Self {
        Self {
            from_files,
            to_files,
            from_file_paths: Self::collect_file_paths(from_files),
            to_file_paths: Self::collect_file_paths(to_files),
            from_dirs: Self::collect_directories(from_files),
            to_dirs: Self::collect_directories(to_files),
            similarity_threshold: similarity_threshold.max(0.0).min(1.0),
            ignore_whitespace,
        }
    }

    pub fn build_tree(&self) -> DiffFileEntry {
        // 1. Identify added/removed files
        let from_paths: HashSet<_> = self.from_files.keys().cloned().collect();
        let to_paths: HashSet<_> = self.to_files.keys().cloned().collect();

        // Sorted, because rename detection is greedy in this order: the
        // first added path to clear the threshold claims a deleted file, and
        // an equal score goes to the first deleted path. Walking a `HashSet`
        // here made that choice arbitrary — the same two packages could
        // build two different trees.
        let mut deleted: Vec<_> = self
            .from_file_paths
            .difference(&self.to_file_paths)
            .cloned()
            .collect();
        let mut added: Vec<_> = self
            .to_file_paths
            .difference(&self.from_file_paths)
            .cloned()
            .collect();
        deleted.sort();
        added.sort();

        // 2. Detect renames
        let renames = self.detect_renames_optimized(&deleted, &added);

        // 3. Build tree structure
        let tree = self.build_tree_structure(
            &from_paths,
            &to_paths,
            &self.from_dirs,
            &self.to_dirs,
            &renames,
        );

        // 4. Compute statuses and counts
        self.compute_tree_stats(tree, &renames)
    }

    fn detect_renames_optimized(
        &self,
        deleted: &[String],
        added: &[String],
    ) -> HashMap<String, String> {
        let mut renames = HashMap::new();
        let mut used = HashSet::new();

        // Phase 1: Exact content matches using hash-based lookup
        let mut del_by_hash: HashMap<u64, Vec<&String>> = HashMap::new();
        for del_path in deleted {
            if let Some(content) = self.file_content(&self.from_files, del_path) {
                let hash = Self::hash_content(content);
                del_by_hash
                    .entry(hash)
                    .or_insert_with(Vec::new)
                    .push(del_path);
            }
        }

        for add_path in added {
            if let Some(add_content) = self.file_content(&self.to_files, add_path) {
                let hash = Self::hash_content(add_content);

                if let Some(candidates) = del_by_hash.get(&hash) {
                    for del_path in candidates {
                        if used.contains(*del_path) {
                            continue;
                        }

                        if let Some(del_content) = self.file_content(&self.from_files, del_path) {
                            if add_content == del_content {
                                renames.insert(add_path.clone(), (*del_path).clone());
                                used.insert((*del_path).clone());
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Phase 2: Similar content with multi-stage filtering

        // Pre-compute line sets for Jaccard similarity (fast pre-filter)
        let mut del_line_sets: HashMap<&String, HashSet<&str>> = HashMap::new();
        for del_path in deleted {
            if used.contains(del_path) {
                continue;
            }
            if let Some(content) = self.file_content(&self.from_files, del_path) {
                del_line_sets.insert(del_path, content.lines().collect());
            }
        }

        for add_path in added {
            if renames.contains_key(add_path) {
                continue;
            }

            let add_content = match self.file_content(&self.to_files, add_path) {
                Some(c) => c,
                None => continue,
            };

            let add_lines: HashSet<&str> = add_content.lines().collect();
            let add_name = add_path.split('/').last().unwrap_or("");
            let mut best: Option<(String, f64)> = None;

            for del_path in deleted {
                if used.contains(del_path) {
                    continue;
                }

                let del_content = match self.file_content(&self.from_files, del_path) {
                    Some(c) => c,
                    None => continue,
                };

                // Filter 1: Length ratio check (very fast)
                if !self.can_be_similar(del_content, add_content) {
                    continue;
                }

                // Filter 2: Jaccard similarity on line sets (fast)
                let del_lines = del_line_sets.get(del_path).unwrap();
                let jaccard = self.jaccard_similarity(&add_lines, del_lines);

                // Early reject if Jaccard is too low (threshold * 0.7 as heuristic)
                if jaccard < self.similarity_threshold * 0.7 {
                    continue;
                }

                // Filter 3: Expensive diff-based similarity (only for promising candidates)
                let similarity = self.calculate_similarity(del_content, add_content);

                // Filename boost
                let del_name = del_path.split('/').last().unwrap_or("");
                let adjusted = if add_name == del_name {
                    similarity * 1.2
                } else {
                    similarity
                };

                if adjusted >= self.similarity_threshold {
                    if let Some((_, best_sim)) = &best {
                        if adjusted > *best_sim {
                            best = Some((del_path.clone(), adjusted));
                        }
                    } else {
                        best = Some((del_path.clone(), adjusted));
                    }
                }
            }

            if let Some((from_path, _)) = best {
                renames.insert(add_path.clone(), from_path.clone());
                used.insert(from_path);
            }
        }

        renames
    }

    fn jaccard_similarity(&self, set1: &HashSet<&str>, set2: &HashSet<&str>) -> f64 {
        if set1.is_empty() && set2.is_empty() {
            return 1.0;
        }

        let intersection = set1.intersection(set2).count();
        let union = set1.len() + set2.len() - intersection;

        if union == 0 {
            return 0.0;
        }

        intersection as f64 / union as f64
    }

    fn can_be_similar(&self, from: &str, to: &str) -> bool {
        let len_ratio = from.len() as f64 / to.len().max(1) as f64;
        len_ratio >= self.similarity_threshold && len_ratio <= 1.0 / self.similarity_threshold
    }

    fn hash_content(content: &str) -> u64 {
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        hasher.finish()
    }

    fn calculate_similarity(&self, from: &str, to: &str) -> f64 {
        if from == to {
            return 1.0;
        }
        if from.is_empty() || to.is_empty() {
            return 0.0;
        }

        let diff = TextDiff::from_lines(from, to);

        let (added, removed, unchanged) = count_op_lines(diff.ops());

        let total = (added + removed + unchanged).max(1);
        unchanged as f64 / total as f64
    }

    fn build_tree_structure(
        &self,
        from_paths: &HashSet<String>,
        to_paths: &HashSet<String>,
        from_dirs: &HashSet<String>,
        to_dirs: &HashSet<String>,
        renames: &HashMap<String, String>,
    ) -> DiffFileEntry {
        // A rename's source path is not a file of its own: the new path stands
        // for both halves, carrying `oldPath` and the diff between them. Left
        // in, it is the same file a second time, listed as a deletion.
        let renamed_away: HashSet<&String> = renames.values().collect();

        // Merge all paths
        let mut all_paths = HashSet::new();
        all_paths.extend(from_paths.iter().cloned());
        all_paths.extend(to_paths.iter().cloned());
        all_paths.extend(from_dirs.iter().cloned());
        all_paths.extend(to_dirs.iter().cloned());

        let mut nodes: HashMap<String, DiffFileEntry> = HashMap::new();
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

        for path in &all_paths {
            if path == "/" || renamed_away.contains(path) {
                continue;
            }
            let file_type = self.resolve_file_type(path, from_dirs, to_dirs);

            nodes.insert(
                path.clone(),
                DiffFileEntry {
                    path: path.clone(),
                    old_path: None,
                    file_type,
                    status: DiffStatus::Unchanged,
                    added: None,
                    removed: None,
                    children: Some(Vec::new()),
                },
            );

            let parent = Self::parent_path(path);
            children_map
                .entry(parent)
                .or_insert_with(Vec::new)
                .push(path.clone());
        }

        let mut root = DiffFileEntry {
            path: "/".to_string(),
            old_path: None,
            file_type: FileType::Directory,
            status: DiffStatus::Unchanged,
            added: None,
            removed: None,
            children: Some(Vec::new()),
        };

        root.children = Some(Self::build_children("/", &mut nodes, &mut children_map));
        root
    }

    fn collect_directories(entries: &HashMap<String, FileMapEntry>) -> HashSet<String> {
        let mut dirs = HashSet::new();

        for (path, entry) in entries {
            // Add directory entries
            if matches!(entry.file_type, FileType::Directory) {
                dirs.insert(path.clone());
            }

            // Add parent directories
            if let Some(last_slash) = path.rfind('/') {
                let mut end = last_slash;
                while end > 0 {
                    if let Some(slash_pos) = path[..end].rfind('/') {
                        dirs.insert(path[..end].to_string());
                        end = slash_pos;
                    } else {
                        // Add the first component if not root
                        if end > 0 {
                            dirs.insert(path[..end].to_string());
                        }
                        break;
                    }
                }
            }
        }

        dirs
    }

    fn build_children(
        parent: &str,
        nodes: &mut HashMap<String, DiffFileEntry>,
        children_map: &mut HashMap<String, Vec<String>>,
    ) -> Vec<DiffFileEntry> {
        let mut child_paths = match children_map.remove(parent) {
            Some(paths) => paths,
            None => return Vec::new(),
        };

        child_paths.sort();
        let mut children = Vec::with_capacity(child_paths.len());

        for child_path in child_paths {
            let mut node = match nodes.remove(&child_path) {
                Some(entry) => entry,
                None => continue,
            };

            let nested = Self::build_children(&child_path, nodes, children_map);

            // A directory with nothing under it is not a change anyone can
            // read — and after a rename out of it, that is exactly what its
            // former home is left as. Pruning bottom-up, an emptied chain of
            // directories goes with it.
            if matches!(node.file_type, FileType::Directory) && nested.is_empty() {
                continue;
            }

            node.children = Some(nested);
            children.push(node);
        }

        children
    }

    fn parent_path(path: &str) -> String {
        if let Some(last_slash) = path.rfind('/') {
            if last_slash == 0 {
                "/".to_string()
            } else {
                path[..last_slash].to_string()
            }
        } else {
            "/".to_string()
        }
    }

    fn compute_tree_stats(
        &self,
        mut root: DiffFileEntry,
        renames: &HashMap<String, String>,
    ) -> DiffFileEntry {
        self.compute_node_stats(&mut root, renames, &self.from_dirs, &self.to_dirs);
        root
    }

    fn compute_node_stats(
        &self,
        node: &mut DiffFileEntry,
        renames: &HashMap<String, String>,
        from_dirs: &HashSet<String>,
        to_dirs: &HashSet<String>,
    ) -> (u32, u32) {
        match node.file_type {
            FileType::File => {
                // Check if this file is a rename
                if let Some(old_path) = renames.get(&node.path) {
                    node.status = DiffStatus::Renamed;
                    node.old_path = Some(old_path.clone());

                    // Calculate diff stats
                    let from_content = self.file_content(&self.from_files, old_path);
                    let to_content = self.file_content(&self.to_files, &node.path);

                    if let (Some(from), Some(to)) = (from_content, to_content) {
                        let (added, removed) = self.count_diff(from, to);
                        node.added = Some(added);
                        node.removed = Some(removed);
                        return (added, removed);
                    }
                }

                let from_content = self.file_content(&self.from_files, &node.path);
                let to_content = self.file_content(&self.to_files, &node.path);

                match (from_content, to_content) {
                    (Some(from), Some(to)) => {
                        if from == to {
                            node.status = DiffStatus::Unchanged;
                            node.added = Some(0);
                            node.removed = Some(0);
                            (0, 0)
                        } else {
                            // The byte-identical fast path above stands in both
                            // modes and skips a diff for most of a version bump.
                            // Past it, a file the mode finds nothing in is
                            // unchanged — that is what drops a reformat out of
                            // the changed files, the tree's default view and the
                            // toolbar's arrows.
                            let (added, removed) = self.count_diff(from, to);
                            node.status = if (added, removed) == (0, 0) {
                                DiffStatus::Unchanged
                            } else {
                                DiffStatus::Modified
                            };
                            node.added = Some(added);
                            node.removed = Some(removed);
                            (added, removed)
                        }
                    }
                    (Some(from), None) => {
                        node.status = DiffStatus::Removed;
                        let removed = from.lines().count() as u32;
                        node.added = Some(0);
                        node.removed = Some(removed);
                        (0, removed)
                    }
                    (None, Some(to)) => {
                        node.status = DiffStatus::Added;
                        let added = to.lines().count() as u32;
                        node.added = Some(added);
                        node.removed = Some(0);
                        (added, 0)
                    }
                    (None, None) => {
                        node.status = DiffStatus::Unchanged;
                        node.added = Some(0);
                        node.removed = Some(0);
                        (0, 0)
                    }
                }
            }
            FileType::Directory => {
                // Recursively compute stats for children
                let mut total_added = 0;
                let mut total_removed = 0;
                let mut all_unchanged = true;

                if let Some(ref mut children) = node.children {
                    for child in children.iter_mut() {
                        let (added, removed) =
                            self.compute_node_stats(child, renames, from_dirs, to_dirs);
                        total_added += added;
                        total_removed += removed;

                        if !matches!(child.status, DiffStatus::Unchanged) {
                            all_unchanged = false;
                        }
                    }
                }

                node.added = Some(total_added);
                node.removed = Some(total_removed);

                // Determine directory status
                let in_from = node.path == "/" || from_dirs.contains(&node.path);
                let in_to = node.path == "/" || to_dirs.contains(&node.path);

                if !in_from && in_to {
                    node.status = DiffStatus::Added;
                } else if in_from && !in_to {
                    node.status = DiffStatus::Removed;
                } else if all_unchanged {
                    node.status = DiffStatus::Unchanged;
                } else {
                    node.status = DiffStatus::Modified;
                }

                (total_added, total_removed)
            }
        }
    }

    /// The tree's `+`/`−`, counted the way the file view renders them — or the
    /// two would contradict each other on the same file. `count_op_lines`
    /// explains why summing op ranges is the same tally the file view reads.
    fn count_diff(&self, from: &str, to: &str) -> (u32, u32) {
        let diff = TextDiff::configure()
            .whitespace_mode(whitespace_mode(self.ignore_whitespace))
            .diff_lines(from, to);

        let (added, removed, _) = count_op_lines(diff.ops());
        // Saturating rather than `as`: a lossy cast would silently wrap a
        // count that no longer fits the `u32` the tree entry carries.
        let added = u32::try_from(added).unwrap_or(u32::MAX);
        let removed = u32::try_from(removed).unwrap_or(u32::MAX);

        (added, removed)
    }

    fn collect_file_paths(entries: &HashMap<String, FileMapEntry>) -> HashSet<String> {
        entries
            .iter()
            .filter_map(|(path, entry)| {
                if matches!(entry.file_type, FileType::File) {
                    Some(path.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    fn resolve_file_type(
        &self,
        path: &str,
        from_dirs: &HashSet<String>,
        to_dirs: &HashSet<String>,
    ) -> FileType {
        if let Some(entry) = self.from_files.get(path).or_else(|| self.to_files.get(path)) {
            return entry.file_type.clone();
        }

        if from_dirs.contains(path) || to_dirs.contains(path) {
            FileType::Directory
        } else {
            FileType::Directory
        }
    }

    fn file_content<'m>(
        &self,
        entries: &'m HashMap<String, FileMapEntry>,
        path: &str,
    ) -> Option<&'m str> {
        entries.get(path).and_then(|entry| {
            if matches!(entry.file_type, FileType::File) {
                Some(entry.content.as_str())
            } else {
                None
            }
        })
    }
}

pub fn build_diff_tree(
    from_files: &HashMap<String, FileMapEntry>,
    to_files: &HashMap<String, FileMapEntry>,
    similarity_threshold: f64,
    ignore_whitespace: bool,
) -> DiffFileEntry {
    DiffTreeBuilder::new(from_files, to_files, similarity_threshold, ignore_whitespace).build_tree()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reformat — tab-indent to four spaces, and spaces around the `=` —
    /// with nothing else touched.
    const FROM: &str = "fn main() {\n\tlet x=1;\n}\n";
    const TO: &str = "fn main() {\n    let x = 1;\n}\n";

    fn file(content: &str) -> FileMapEntry {
        FileMapEntry {
            file_type: FileType::File,
            content: content.to_string(),
        }
    }

    fn one_file(content: &str) -> HashMap<String, FileMapEntry> {
        HashMap::from([("a.rs".to_string(), file(content))])
    }

    /// `count_diff` reads only the whitespace mode, so a builder over no
    /// files is enough to call it.
    fn builder(ignore_whitespace: bool) -> DiffTreeBuilder<'static> {
        let empty: &'static HashMap<String, FileMapEntry> = Box::leak(Box::default());
        DiffTreeBuilder::new(empty, empty, 0.75, ignore_whitespace)
    }

    fn files(entries: &[(&str, &str)]) -> HashMap<String, FileMapEntry> {
        entries
            .iter()
            .map(|(path, content)| ((*path).to_string(), file(content)))
            .collect()
    }

    /// Every file in the tree, in tree order — the list the panel renders.
    fn listed_files(node: &DiffFileEntry) -> Vec<&DiffFileEntry> {
        if matches!(node.file_type, FileType::File) {
            return vec![node];
        }

        node.children
            .as_ref()
            .map(|children| children.iter().flat_map(listed_files).collect())
            .unwrap_or_default()
    }

    fn paths(node: &DiffFileEntry) -> Vec<&str> {
        listed_files(node)
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    /// Every node in the tree, directories included, in tree order.
    fn all_paths(node: &DiffFileEntry) -> Vec<&str> {
        let mut out = vec![node.path.as_str()];
        for child in node.children.iter().flatten() {
            out.extend(all_paths(child));
        }
        out
    }

    /// Long enough that a one-line edit still reads as the same file to the
    /// rename detector, which is what a renamed-and-touched file looks like.
    const REPORTER: &str = "import { a } from './a';\nimport { b } from './b';\n\nexport function report(x) {\n  const y = a(x);\n  const z = b(y);\n  return z + 1;\n}\n\nexport default report;\n";
    const REPORTER_EDITED: &str = "import { a } from './a';\nimport { b } from './b';\n\nexport function report(x) {\n  const y = a(x);\n  const z = b(y);\n  return z + 2;\n}\n\nexport default report;\n";

    #[test]
    fn a_renamed_file_is_listed_once_at_its_new_path() {
        let tree = build_diff_tree(
            &files(&[("src/reporter.ts", REPORTER)]),
            &files(&[("src/report.ts", REPORTER_EDITED)]),
            0.75,
            false,
        );

        assert_eq!(paths(&tree), ["src/report.ts"]);

        let entry = listed_files(&tree)[0];
        assert!(matches!(entry.status, DiffStatus::Renamed));
        assert_eq!(entry.old_path.as_deref(), Some("src/reporter.ts"));
    }

    #[test]
    fn a_rename_out_of_a_directory_leaves_no_empty_directory_behind() {
        let tree = build_diff_tree(
            &files(&[("src/legacy/reporter.ts", REPORTER)]),
            &files(&[("src/reporter.ts", REPORTER_EDITED)]),
            0.75,
            false,
        );

        assert_eq!(all_paths(&tree), ["/", "src", "src/reporter.ts"]);
    }

    /// `n` numbered lines with the listed ones rewritten, so two files can
    /// be a known number of edits apart.
    fn lines_with_edits(n: usize, edits: &[usize]) -> String {
        (0..n)
            .map(|i| {
                if edits.contains(&i) {
                    format!("edited {}\n", i)
                } else {
                    format!("line {}\n", i)
                }
            })
            .collect()
    }

    /// `(path, status, oldPath)` for every file, in tree order.
    fn outcomes(node: &DiffFileEntry) -> Vec<(&str, DiffStatus, Option<&str>)> {
        listed_files(node)
            .iter()
            .map(|e| (e.path.as_str(), e.status.clone(), e.old_path.as_deref()))
            .collect()
    }

    // The rename pass is greedy, and these pin which candidate it takes when
    // more than one could. Restructuring the loop for speed must not move
    // any of them.

    #[test]
    fn an_exact_copy_beats_a_near_copy_with_the_same_name() {
        let tree = build_diff_tree(
            &files(&[
                ("a/x.ts", &lines_with_edits(20, &[])),
                ("b/y.ts", &lines_with_edits(20, &[3])),
            ]),
            &files(&[("c/y.ts", &lines_with_edits(20, &[]))]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("b/y.ts", DiffStatus::Removed, None),
                ("c/y.ts", DiffStatus::Renamed, Some("a/x.ts")),
            ]
        );
    }

    #[test]
    fn identical_files_pair_up_in_path_order() {
        let content = lines_with_edits(20, &[]);
        let tree = build_diff_tree(
            &files(&[("z/one.ts", &content), ("a/one.ts", &content)]),
            &files(&[("n/one.ts", &content), ("m/one.ts", &content)]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("m/one.ts", DiffStatus::Renamed, Some("a/one.ts")),
                ("n/one.ts", DiffStatus::Renamed, Some("z/one.ts")),
            ]
        );
    }

    #[test]
    fn a_same_named_candidate_wins_over_a_closer_one_with_another_name() {
        // `old/aaa.ts` is one edit away and sorts first; `old/report.ts` is
        // two edits away but shares the name, and the name is worth more.
        let tree = build_diff_tree(
            &files(&[
                ("old/aaa.ts", &lines_with_edits(20, &[3])),
                ("old/report.ts", &lines_with_edits(20, &[3, 7])),
            ]),
            &files(&[("new/report.ts", &lines_with_edits(20, &[]))]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("new/report.ts", DiffStatus::Renamed, Some("old/report.ts")),
                ("old/aaa.ts", DiffStatus::Removed, None),
            ]
        );
    }

    #[test]
    fn an_equal_score_goes_to_the_first_deleted_path() {
        let near = lines_with_edits(20, &[3]);
        let tree = build_diff_tree(
            &files(&[("b/x.ts", &near), ("a/x.ts", &near)]),
            &files(&[("n/x.ts", &lines_with_edits(20, &[]))]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("b/x.ts", DiffStatus::Removed, None),
                ("n/x.ts", DiffStatus::Renamed, Some("a/x.ts")),
            ]
        );
    }

    #[test]
    fn the_first_added_path_claims_a_deleted_file_both_could_match() {
        let tree = build_diff_tree(
            &files(&[("old/x.ts", &lines_with_edits(20, &[]))]),
            &files(&[
                ("new/b.ts", &lines_with_edits(20, &[3])),
                ("new/a.ts", &lines_with_edits(20, &[7])),
            ]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("new/a.ts", DiffStatus::Renamed, Some("old/x.ts")),
                ("new/b.ts", DiffStatus::Added, None),
            ]
        );
    }

    #[test]
    fn files_of_equal_length_sharing_no_line_are_not_a_rename() {
        let other: String = (0..20).map(|i| format!("othr {}\n", i)).collect();
        let tree = build_diff_tree(
            &files(&[("a.ts", &lines_with_edits(20, &[]))]),
            &files(&[("b.ts", &other)]),
            0.75,
            false,
        );

        assert_eq!(
            outcomes(&tree),
            [
                ("a.ts", DiffStatus::Removed, None),
                ("b.ts", DiffStatus::Added, None),
            ]
        );
    }

    #[test]
    fn renders_a_reformatted_line_as_a_change_when_exact() {
        assert_eq!(
            get_diff_content("a.rs", FROM, TO, false),
            "--- from/a.rs\n+++ to/a.rs\n  fn main() {\n- \tlet x=1;\n+     let x = 1;\n  }"
        );
    }

    #[test]
    fn folds_a_reformatted_line_into_context_when_ignoring_whitespace() {
        // The new file's text is what a whitespace-equal line shows, which is
        // what Git does and what the reader is reading towards.
        assert_eq!(
            get_diff_content("a.rs", FROM, TO, true),
            "--- from/a.rs\n+++ to/a.rs\n  fn main() {\n      let x = 1;\n  }"
        );
    }

    #[test]
    fn keeps_a_real_change_while_ignoring_the_reformat_around_it() {
        let to = "fn main() {\n    let x = 1;\n    println!(\"{}\", x);\n}\n";
        assert_eq!(
            get_diff_content("a.rs", "fn main() {\n\tlet x=1;\n}\n", to, true),
            "--- from/a.rs\n+++ to/a.rs\n  fn main() {\n      let x = 1;\n+     println!(\"{}\", x);\n  }"
        );
    }

    #[test]
    fn a_file_ending_in_a_newline_has_no_phantom_final_line() {
        // `split('\n')` left a trailing empty element; `diff_lines` does not,
        // and the count the tree reports has always been the latter's.
        assert_eq!(
            get_diff_content("a.rs", "a\nb\n", "a\nc\n", false),
            "--- from/a.rs\n+++ to/a.rs\n  a\n- b\n+ c"
        );
    }

    #[test]
    fn a_reformat_only_file_counts_as_no_change_when_ignoring_whitespace() {
        assert_eq!(builder(true).count_diff(FROM, TO), (0, 0));
        assert_eq!(builder(false).count_diff(FROM, TO), (1, 1));
    }

    #[test]
    fn a_reformat_only_file_leaves_the_changed_files() {
        let tree = build_diff_tree(&one_file(FROM), &one_file(TO), 0.75, true);
        let entry = &tree.children.as_ref().unwrap()[0];
        assert!(matches!(entry.status, DiffStatus::Unchanged));
        assert_eq!((entry.added, entry.removed), (Some(0), Some(0)));
    }

    #[test]
    fn the_same_file_is_modified_when_whitespace_counts() {
        let tree = build_diff_tree(&one_file(FROM), &one_file(TO), 0.75, false);
        let entry = &tree.children.as_ref().unwrap()[0];
        assert!(matches!(entry.status, DiffStatus::Modified));
        assert_eq!((entry.added, entry.removed), (Some(1), Some(1)));
    }

    /// `n` numbered lines, so a middle section can be replaced while most of
    /// the file stays one long unchanged run.
    fn numbered_lines(n: usize) -> String {
        (0..n).map(|i| format!("line {}\n", i)).collect()
    }

    fn with_replaced_line(n: usize, at: usize, replacement: &[&str]) -> String {
        let mut lines: Vec<String> = (0..n).map(|i| format!("line {}", i)).collect();
        lines.splice(at..at + 1, replacement.iter().map(|s| s.to_string()));
        let mut out = lines.join("\n");
        out.push('\n');
        out
    }

    /// Counts the `+`/`-` prefixed lines the way a reader counts them by
    /// eye — `count_diff`'s numbers must agree with what this reads off.
    fn diff_content_counts(diff_output: &str) -> (u32, u32) {
        diff_output
            .split('\n')
            .skip(2) // the "--- from/..." and "+++ to/..." header lines
            .fold((0, 0), |(added, removed), line| {
                match line.as_bytes().first() {
                    Some(b'+') => (added + 1, removed),
                    Some(b'-') => (added, removed + 1),
                    _ => (added, removed),
                }
            })
    }

    #[test]
    fn count_diff_agrees_with_get_diff_content_for_a_mixed_change() {
        let from = with_replaced_line(200, 100, &["changed line"]);
        let to = with_replaced_line(200, 100, &["changed line", "an inserted line"]);

        for ignore_whitespace in [false, true] {
            let builder = builder(ignore_whitespace);
            let counted = builder.count_diff(&from, &to);
            let content = get_diff_content("a.rs", &from, &to, ignore_whitespace);
            assert_eq!(counted, diff_content_counts(&content));
        }
    }

    #[test]
    fn count_diff_agrees_with_get_diff_content_for_a_reformat_under_both_modes() {
        for ignore_whitespace in [false, true] {
            let builder = builder(ignore_whitespace);
            let counted = builder.count_diff(FROM, TO);
            let content = get_diff_content("a.rs", FROM, TO, ignore_whitespace);
            assert_eq!(counted, diff_content_counts(&content));
        }
    }

    /// A single line replaced deep inside a run long enough that most of the
    /// file is one unchanged block either side of it.
    #[test]
    fn count_diff_finds_a_single_replaced_line_in_a_long_unchanged_file() {
        let from = numbered_lines(300);
        let to = with_replaced_line(300, 150, &["a completely different line"]);

        let builder = builder(false);
        assert_eq!(builder.count_diff(&from, &to), (1, 1));
    }
}
