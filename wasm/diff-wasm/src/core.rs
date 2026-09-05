use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};
use similar::{ChangeTag, TextDiff, WhitespaceMode};
use std::collections::{HashMap, HashSet};

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

    /// Pairs each added file with the deleted file it was most likely moved
    /// from. Greedy, in the sorted order `build_tree` hands over: exact
    /// copies pair up first, then the closest surviving candidate above the
    /// threshold, an equal score going to the first deleted path.
    ///
    /// Two indexes stand in for the pairwise scan this used to be. Exact
    /// copies are found by byte length and a comparison, rather than hashing
    /// every file in full. For the rest, an inverted index from each line of
    /// the deleted files to the files it occurs in turns the Jaccard step
    /// around: instead of intersecting an added file's lines with every
    /// deleted file's, one lookup per line counts the shared lines with each
    /// deleted file at once, and files sharing no line are never visited.
    /// On `date-fns 1.30.1 → 2.0.0`, 703 deleted against 3911 added, that
    /// pairwise scan was 194 ms of a 208 ms diff.
    fn detect_renames_optimized(
        &self,
        deleted: &[String],
        added: &[String],
    ) -> HashMap<String, String> {
        let mut renames = HashMap::new();
        if deleted.is_empty() || added.is_empty() {
            return renames;
        }
        let mut used = vec![false; deleted.len()];

        // Phase 1: exact copies. Same length first, then the bytes — a
        // mismatch stops at the first differing byte, where a hash would
        // have read every file to the end.
        let mut del_by_len: HashMap<usize, Vec<usize>> = HashMap::new();
        for (i, del_path) in deleted.iter().enumerate() {
            if let Some(content) = self.file_content(self.from_files, del_path) {
                del_by_len.entry(content.len()).or_default().push(i);
            }
        }

        for add_path in added {
            let Some(add_content) = self.file_content(self.to_files, add_path) else {
                continue;
            };
            let Some(bucket) = del_by_len.get(&add_content.len()) else {
                continue;
            };
            let exact = bucket.iter().copied().find(|&i| {
                !used[i] && self.file_content(self.from_files, &deleted[i]) == Some(add_content)
            });
            if let Some(i) = exact {
                renames.insert(add_path.clone(), deleted[i].clone());
                used[i] = true;
            }
        }

        // Phase 2: near copies. `heads` maps a line to the start of its
        // chain in `postings`, each entry the index of a deleted file that
        // contains the line and the next entry of the chain. A flat chain
        // rather than a `Vec` per line: one allocation for every posting in
        // the index instead of one per distinct line.
        let mut heads: HashMap<&str, u32> = HashMap::new();
        let mut postings: Vec<(u32, u32)> = Vec::new();
        const END: u32 = u32::MAX;
        let mut del_lines = vec![0usize; deleted.len()];
        let mut del_len = vec![0usize; deleted.len()];
        for (i, del_path) in deleted.iter().enumerate() {
            if used[i] {
                continue;
            }
            let Some(content) = self.file_content(self.from_files, del_path) else {
                continue;
            };
            let lines: HashSet<&str> = content.lines().collect();
            del_lines[i] = lines.len();
            del_len[i] = content.len();
            for line in lines {
                let head = heads.entry(line).or_insert(END);
                postings.push((i as u32, *head));
                *head = (postings.len() - 1) as u32;
            }
        }
        // Every deleted file was an exact copy of something: nothing left
        // to pair the remaining added files with, so no line sets for them.
        if postings.is_empty() {
            return renames;
        }

        let mut shared = vec![0u32; deleted.len()];
        let mut touched: Vec<usize> = Vec::new();
        let jaccard_floor = self.similarity_threshold * 0.7;

        for add_path in added {
            if renames.contains_key(add_path) {
                continue;
            }
            let Some(add_content) = self.file_content(self.to_files, add_path) else {
                continue;
            };

            let add_lines: HashSet<&str> = add_content.lines().collect();
            for line in &add_lines {
                let mut next = heads.get(line).copied().unwrap_or(END);
                while next != END {
                    let (i, after) = postings[next as usize];
                    let i = i as usize;
                    if shared[i] == 0 {
                        touched.push(i);
                    }
                    shared[i] += 1;
                    next = after;
                }
            }

            let add_name = add_path.split('/').last().unwrap_or("");
            let mut best: Option<(usize, f64)> = None;

            for &i in &touched {
                let count = shared[i] as usize;
                shared[i] = 0;
                if used[i] {
                    continue;
                }

                // Filter 1: byte length ratio.
                if !self.can_be_similar_len(del_len[i], add_content.len()) {
                    continue;
                }

                // Filter 2: Jaccard over line sets, the shared count being
                // exactly what the index lookups just tallied.
                let union = add_lines.len() + del_lines[i] - count;
                let jaccard = if union == 0 {
                    0.0
                } else {
                    count as f64 / union as f64
                };
                if jaccard < jaccard_floor {
                    continue;
                }

                // Filter 3: the diff itself, for the few that get this far.
                let del_path = &deleted[i];
                let Some(del_content) = self.file_content(self.from_files, del_path) else {
                    continue;
                };
                let similarity = self.calculate_similarity(del_content, add_content);

                let del_name = del_path.split('/').last().unwrap_or("");
                let adjusted = if add_name == del_name {
                    similarity * 1.2
                } else {
                    similarity
                };

                if adjusted < self.similarity_threshold {
                    continue;
                }
                // `touched` is in lookup order, not path order, so the tie
                // goes to the lower index by comparison rather than by
                // arrival.
                let better = match best {
                    None => true,
                    Some((best_i, best_sim)) => {
                        adjusted > best_sim || (adjusted == best_sim && i < best_i)
                    }
                };
                if better {
                    best = Some((i, adjusted));
                }
            }
            touched.clear();

            if let Some((i, _)) = best {
                renames.insert(add_path.clone(), deleted[i].clone());
                used[i] = true;
            }
        }

        renames
    }

    fn can_be_similar_len(&self, from_len: usize, to_len: usize) -> bool {
        let len_ratio = from_len as f64 / to_len.max(1) as f64;
        len_ratio >= self.similarity_threshold && len_ratio <= 1.0 / self.similarity_threshold
    }

    fn calculate_similarity(&self, from: &str, to: &str) -> f64 {
        if from == to {
            return 1.0;
        }
        if from.is_empty() || to.is_empty() {
            return 0.0;
        }

        let diff = TextDiff::from_lines(from, to);

        // Count changes using the 'similar' crate
        let mut added = 0;
        let mut removed = 0;
        let mut unchanged = 0;

        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Insert => added += 1,
                ChangeTag::Delete => removed += 1,
                ChangeTag::Equal => unchanged += 1,
            }
        }

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
    /// two would contradict each other on the same file.
    fn count_diff(&self, from: &str, to: &str) -> (u32, u32) {
        let diff = TextDiff::configure()
            .whitespace_mode(whitespace_mode(self.ignore_whitespace))
            .diff_lines(from, to);

        let mut added = 0;
        let mut removed = 0;

        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Insert => added += 1,
                ChangeTag::Delete => removed += 1,
                _ => {}
            }
        }

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
        if let Some(entry) = self
            .from_files
            .get(path)
            .or_else(|| self.to_files.get(path))
        {
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
    DiffTreeBuilder::new(
        from_files,
        to_files,
        similarity_threshold,
        ignore_whitespace,
    )
    .build_tree()
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

    // ---- helpers ----------------------------------------------------------

    fn dir() -> FileMapEntry {
        FileMapEntry {
            file_type: FileType::Directory,
            content: String::new(),
        }
    }

    /// The tree node at `path`, directories included.
    fn node_at<'t>(root: &'t DiffFileEntry, path: &str) -> &'t DiffFileEntry {
        fn walk<'t>(node: &'t DiffFileEntry, path: &str) -> Option<&'t DiffFileEntry> {
            if node.path == path {
                return Some(node);
            }
            node.children
                .iter()
                .flatten()
                .find_map(|child| walk(child, path))
        }
        walk(root, path).unwrap_or_else(|| panic!("{path} is not in {:?}", all_paths(root)))
    }

    fn tree(from: &[(&str, &str)], to: &[(&str, &str)]) -> DiffFileEntry {
        build_diff_tree(&files(from), &files(to), 0.75, false)
    }

    // ---- whitespace mode --------------------------------------------------

    #[test]
    fn ignoring_whitespace_is_the_only_thing_that_reaches_ignore_all() {
        assert!(matches!(whitespace_mode(true), WhitespaceMode::IgnoreAll));
        assert!(matches!(whitespace_mode(false), WhitespaceMode::Exact));
    }

    // ---- get_diff_content -------------------------------------------------

    #[test]
    fn a_diff_opens_with_the_two_file_headers() {
        let diff = get_diff_content("src/a.rs", "one\n", "two\n", false);
        assert!(diff.starts_with("--- from/src/a.rs\n+++ to/src/a.rs\n"));
    }

    #[test]
    fn every_line_carries_its_sign_and_a_space() {
        assert_eq!(
            get_diff_content("a.rs", "keep\ndrop\n", "keep\nadd\n", false),
            "--- from/a.rs\n+++ to/a.rs\n  keep\n- drop\n+ add"
        );
    }

    #[test]
    fn two_identical_contents_diff_to_headers_and_context_only() {
        assert_eq!(
            get_diff_content("a.rs", "same\n", "same\n", false),
            "--- from/a.rs\n+++ to/a.rs\n  same"
        );
    }

    // ---- the similarity threshold -----------------------------------------

    /// The threshold is a ratio, and every filter built on it assumes that.
    /// A caller handing over 2.0 or -1 must not be able to disable them.
    #[test]
    fn a_threshold_outside_zero_to_one_is_clamped() {
        let empty: HashMap<String, FileMapEntry> = HashMap::new();
        assert_eq!(
            DiffTreeBuilder::new(&empty, &empty, 2.0, false).similarity_threshold,
            1.0
        );
        assert_eq!(
            DiffTreeBuilder::new(&empty, &empty, -1.0, false).similarity_threshold,
            0.0
        );
        assert_eq!(
            DiffTreeBuilder::new(&empty, &empty, 0.6, false).similarity_threshold,
            0.6
        );
    }

    // ---- can_be_similar_len -----------------------------------------------

    /// The cheap first filter: a file cannot be a 0.75-similar copy of one
    /// four times its length, whatever its lines say.
    #[test]
    fn the_length_filter_is_symmetric_around_the_threshold() {
        let b = builder(false); // threshold 0.75
        assert!(b.can_be_similar_len(100, 100));
        assert!(b.can_be_similar_len(75, 100));
        assert!(b.can_be_similar_len(100, 75));
        assert!(!b.can_be_similar_len(74, 100));
        assert!(!b.can_be_similar_len(100, 74));
    }

    /// An empty candidate would be a division by zero; the length of 1 it is
    /// given instead makes anything non-trivial fail the filter.
    #[test]
    fn a_zero_length_candidate_does_not_divide_by_zero() {
        let b = builder(false);
        assert!(!b.can_be_similar_len(100, 0));
        assert!(b.can_be_similar_len(1, 0));
    }

    // ---- calculate_similarity ---------------------------------------------

    #[test]
    fn identical_content_is_perfectly_similar_and_an_empty_side_is_not_similar_at_all() {
        let b = builder(false);
        assert_eq!(b.calculate_similarity("a\nb\n", "a\nb\n"), 1.0);
        assert_eq!(b.calculate_similarity("", "a\n"), 0.0);
        assert_eq!(b.calculate_similarity("a\n", ""), 0.0);
        // Both empty is the equality case, checked before the emptiness one.
        assert_eq!(b.calculate_similarity("", ""), 1.0);
    }

    /// Three lines kept, one replaced: four unchanged of six changes counted.
    #[test]
    fn similarity_is_the_share_of_lines_the_diff_left_alone() {
        let b = builder(false);
        let from = "a\nb\nc\nd\n";
        let to = "a\nb\nc\nD\n";
        let similarity = b.calculate_similarity(from, to);
        assert!((similarity - 3.0 / 5.0).abs() < 1e-9, "got {similarity}");
    }

    #[test]
    fn files_sharing_nothing_are_not_similar() {
        let b = builder(false);
        assert_eq!(b.calculate_similarity("a\nb\n", "y\nz\n"), 0.0);
    }

    // ---- count_diff -------------------------------------------------------

    #[test]
    fn counting_a_diff_returns_inserted_and_deleted_lines() {
        assert_eq!(
            builder(false).count_diff("a\nb\nc\n", "a\nB\nc\nd\n"),
            (2, 1)
        );
        assert_eq!(builder(false).count_diff("a\n", "a\n"), (0, 0));
        assert_eq!(builder(false).count_diff("", "a\nb\n"), (2, 0));
        assert_eq!(builder(false).count_diff("a\nb\n", ""), (0, 2));
    }

    #[test]
    fn counting_a_reformat_depends_on_the_whitespace_mode() {
        assert_eq!(builder(false).count_diff(FROM, TO), (1, 1));
        assert_eq!(builder(true).count_diff(FROM, TO), (0, 0));
    }

    // ---- path and entry bookkeeping ---------------------------------------

    #[test]
    fn only_files_are_collected_as_file_paths() {
        let entries = HashMap::from([
            ("src".to_string(), dir()),
            ("src/a.rs".to_string(), file("x")),
            ("README.md".to_string(), file("y")),
        ]);
        let mut paths: Vec<String> = DiffTreeBuilder::collect_file_paths(&entries)
            .into_iter()
            .collect();
        paths.sort();
        assert_eq!(paths, ["README.md", "src/a.rs"]);
    }

    /// Explicit directory entries and every ancestor implied by a file path,
    /// so a package that ships no directory entries still builds a tree.
    #[test]
    fn directories_come_from_entries_and_from_the_ancestors_of_files() {
        let entries = HashMap::from([
            ("docs".to_string(), dir()),
            ("a/b/c/file.rs".to_string(), file("x")),
            ("top.rs".to_string(), file("y")),
        ]);
        let mut dirs: Vec<String> = DiffTreeBuilder::collect_directories(&entries)
            .into_iter()
            .collect();
        dirs.sort();
        assert_eq!(dirs, ["a", "a/b", "a/b/c", "docs"]);
    }

    #[test]
    fn a_paths_parent_is_everything_before_its_last_slash() {
        assert_eq!(DiffTreeBuilder::parent_path("a/b/c.rs"), "a/b");
        assert_eq!(DiffTreeBuilder::parent_path("a/b"), "a");
        assert_eq!(DiffTreeBuilder::parent_path("top.rs"), "/");
        assert_eq!(DiffTreeBuilder::parent_path("/top.rs"), "/");
        assert_eq!(DiffTreeBuilder::parent_path(""), "/");
    }

    /// A path present on either side takes that side's type; one known only
    /// as an ancestor is a directory.
    #[test]
    fn a_paths_type_comes_from_whichever_side_has_it() {
        let from = HashMap::from([("a.rs".to_string(), file("x"))]);
        let to = HashMap::from([("docs".to_string(), dir()), ("b.rs".to_string(), file("y"))]);
        let b = DiffTreeBuilder::new(&from, &to, 0.75, false);
        let no_dirs = HashSet::new();

        assert!(matches!(
            b.resolve_file_type("a.rs", &no_dirs, &no_dirs),
            FileType::File
        ));
        assert!(matches!(
            b.resolve_file_type("b.rs", &no_dirs, &no_dirs),
            FileType::File
        ));
        assert!(matches!(
            b.resolve_file_type("docs", &no_dirs, &no_dirs),
            FileType::Directory
        ));
        assert!(matches!(
            b.resolve_file_type("src", &no_dirs, &no_dirs),
            FileType::Directory
        ));
    }

    /// A directory has no content to diff, so it must not answer with the
    /// empty string a file's content would be compared against.
    #[test]
    fn only_a_file_has_content() {
        let entries = HashMap::from([
            ("src".to_string(), dir()),
            ("src/a.rs".to_string(), file("body")),
        ]);
        let b = builder(false);
        assert_eq!(b.file_content(&entries, "src/a.rs"), Some("body"));
        assert_eq!(b.file_content(&entries, "src"), None);
        assert_eq!(b.file_content(&entries, "missing.rs"), None);
    }

    // ---- tree structure ---------------------------------------------------

    #[test]
    fn the_tree_is_rooted_at_a_slash_and_children_are_sorted() {
        let tree = tree(
            &[("b.rs", "x\n"), ("a.rs", "x\n"), ("src/z.rs", "x\n")],
            &[],
        );
        assert_eq!(tree.path, "/");
        assert!(matches!(tree.file_type, FileType::Directory));
        let top: Vec<&str> = tree
            .children
            .iter()
            .flatten()
            .map(|child| child.path.as_str())
            .collect();
        assert_eq!(top, ["a.rs", "b.rs", "src"]);
    }

    #[test]
    fn a_nested_file_hangs_off_its_own_directory_chain() {
        let tree = tree(&[], &[("a/b/c.rs", "x\n")]);
        assert_eq!(all_paths(&tree), ["/", "a", "a/b", "a/b/c.rs"]);
    }

    #[test]
    fn a_directory_with_nothing_under_it_is_not_in_the_tree() {
        let from = HashMap::from([
            ("empty".to_string(), dir()),
            ("a.rs".to_string(), file("x\n")),
        ]);
        let to = HashMap::from([("a.rs".to_string(), file("x\n"))]);
        let tree = build_diff_tree(&from, &to, 0.75, false);
        assert_eq!(all_paths(&tree), ["/", "a.rs"]);
    }

    /// Both packages are empty: a root with no children, not a panic.
    #[test]
    fn two_empty_packages_build_an_empty_tree() {
        let tree = tree(&[], &[]);
        assert_eq!(all_paths(&tree), ["/"]);
        assert_eq!(tree.status, DiffStatus::Unchanged);
        assert_eq!(tree.added, Some(0));
        assert_eq!(tree.removed, Some(0));
    }

    // ---- statuses and counts ----------------------------------------------

    #[test]
    fn an_added_file_counts_every_line_as_added() {
        let tree = tree(&[], &[("a.rs", "one\ntwo\nthree\n")]);
        let node = node_at(&tree, "a.rs");
        assert_eq!(node.status, DiffStatus::Added);
        assert_eq!((node.added, node.removed), (Some(3), Some(0)));
        assert_eq!(node.old_path, None);
    }

    #[test]
    fn a_removed_file_counts_every_line_as_removed() {
        let tree = tree(&[("a.rs", "one\ntwo\n")], &[]);
        let node = node_at(&tree, "a.rs");
        assert_eq!(node.status, DiffStatus::Removed);
        assert_eq!((node.added, node.removed), (Some(0), Some(2)));
    }

    #[test]
    fn a_byte_identical_file_is_unchanged_and_costs_no_diff() {
        let tree = tree(&[("a.rs", "one\ntwo\n")], &[("a.rs", "one\ntwo\n")]);
        let node = node_at(&tree, "a.rs");
        assert_eq!(node.status, DiffStatus::Unchanged);
        assert_eq!((node.added, node.removed), (Some(0), Some(0)));
    }

    #[test]
    fn an_edited_file_is_modified_and_carries_its_counts() {
        let tree = tree(&[("a.rs", "one\ntwo\n")], &[("a.rs", "one\nTWO\nthree\n")]);
        let node = node_at(&tree, "a.rs");
        assert_eq!(node.status, DiffStatus::Modified);
        assert_eq!((node.added, node.removed), (Some(2), Some(1)));
    }

    /// A directory sums what is under it, however deep.
    #[test]
    fn a_directory_sums_the_counts_of_everything_beneath_it() {
        let tree = tree(
            &[("src/a.rs", "one\n")],
            &[("src/a.rs", "ONE\n"), ("src/deep/b.rs", "x\ny\n")],
        );
        let src = node_at(&tree, "src");
        assert_eq!(src.status, DiffStatus::Modified);
        assert_eq!((src.added, src.removed), (Some(3), Some(1)));
        assert_eq!(tree.added, Some(3));
        assert_eq!(tree.removed, Some(1));
    }

    #[test]
    fn a_directory_only_the_new_version_has_is_added() {
        let tree = tree(&[("a.rs", "x\n")], &[("a.rs", "x\n"), ("docs/b.md", "y\n")]);
        assert_eq!(node_at(&tree, "docs").status, DiffStatus::Added);
    }

    #[test]
    fn a_directory_only_the_old_version_had_is_removed() {
        let tree = tree(&[("a.rs", "x\n"), ("docs/b.md", "y\n")], &[("a.rs", "x\n")]);
        assert_eq!(node_at(&tree, "docs").status, DiffStatus::Removed);
    }

    #[test]
    fn a_directory_whose_children_are_all_unchanged_is_unchanged() {
        let tree = tree(&[("src/a.rs", "x\n")], &[("src/a.rs", "x\n")]);
        assert_eq!(node_at(&tree, "src").status, DiffStatus::Unchanged);
        assert_eq!(tree.status, DiffStatus::Unchanged);
    }

    /// The root is in both versions by definition, so it is never added or
    /// removed — only unchanged or modified.
    #[test]
    fn the_root_is_modified_when_anything_under_it_changed() {
        assert_eq!(tree(&[], &[("a.rs", "x\n")]).status, DiffStatus::Modified);
        assert_eq!(tree(&[("a.rs", "x\n")], &[]).status, DiffStatus::Modified);
    }

    // ---- rename detection -------------------------------------------------

    /// Nothing was added or nothing was deleted: no pair can exist, and the
    /// detector must say so before building any index.
    #[test]
    fn a_one_sided_change_produces_no_renames() {
        let b = builder(false);
        assert!(b
            .detect_renames_optimized(&[], &["a.rs".to_string()])
            .is_empty());
        assert!(b
            .detect_renames_optimized(&["a.rs".to_string()], &[])
            .is_empty());
    }

    #[test]
    fn a_file_moved_without_an_edit_is_a_rename() {
        let tree = tree(&[("src/a.rs", REPORTER)], &[("lib/a.rs", REPORTER)]);
        let node = node_at(&tree, "lib/a.rs");
        assert_eq!(node.status, DiffStatus::Renamed);
        assert_eq!(node.old_path.as_deref(), Some("src/a.rs"));
        assert_eq!((node.added, node.removed), (Some(0), Some(0)));
    }

    #[test]
    fn a_renamed_file_carries_the_counts_of_the_edit_that_came_with_it() {
        let tree = tree(&[("src/a.rs", REPORTER)], &[("src/b.rs", REPORTER_EDITED)]);
        let node = node_at(&tree, "src/b.rs");
        assert_eq!(node.status, DiffStatus::Renamed);
        assert_eq!(node.old_path.as_deref(), Some("src/a.rs"));
        assert_eq!((node.added, node.removed), (Some(1), Some(1)));
    }

    /// Two files sharing no line at all: an add and a delete, not a rename.
    #[test]
    fn two_unrelated_files_are_an_add_and_a_delete() {
        let tree = tree(&[("a.rs", "alpha\nbeta\n")], &[("b.rs", "gamma\ndelta\n")]);
        assert_eq!(node_at(&tree, "a.rs").status, DiffStatus::Removed);
        assert_eq!(node_at(&tree, "b.rs").status, DiffStatus::Added);
    }

    /// A threshold of 0 pairs anything the length filter lets through, and a
    /// threshold of 1 pairs only exact copies — the two ends of the knob.
    #[test]
    fn the_threshold_decides_how_far_a_rename_may_stretch() {
        let from = files(&[("a.rs", REPORTER)]);
        let to = files(&[("b.rs", REPORTER_EDITED)]);

        let strict = build_diff_tree(&from, &to, 1.0, false);
        assert_eq!(node_at(&strict, "b.rs").status, DiffStatus::Added);

        let loose = build_diff_tree(&from, &to, 0.0, false);
        assert_eq!(node_at(&loose, "b.rs").status, DiffStatus::Renamed);
    }

    /// A deleted file claimed by an exact copy is not available to a near one.
    #[test]
    fn a_deleted_file_is_claimed_at_most_once() {
        let tree = tree(
            &[("a.rs", REPORTER)],
            &[("copy.rs", REPORTER), ("edited.rs", REPORTER_EDITED)],
        );
        assert_eq!(node_at(&tree, "copy.rs").status, DiffStatus::Renamed);
        assert_eq!(node_at(&tree, "copy.rs").old_path.as_deref(), Some("a.rs"));
        assert_eq!(node_at(&tree, "edited.rs").status, DiffStatus::Added);
    }

    /// Directories are not renamed as such: a moved file appears at its new
    /// path and its old directory is gone.
    #[test]
    fn moving_a_file_between_directories_moves_the_node() {
        let tree = tree(&[("old/a.rs", REPORTER)], &[("new/a.rs", REPORTER)]);
        assert_eq!(all_paths(&tree), ["/", "new", "new/a.rs"]);
        assert_eq!(node_at(&tree, "new").status, DiffStatus::Added);
    }

    // ---- the free function ------------------------------------------------

    /// `build_diff_tree` is what `lib.rs` and `examples/bench.rs` call; it
    /// must be the builder and nothing else.
    #[test]
    fn the_free_function_is_the_builder() {
        let from = files(&[("a.rs", "one\n"), ("src/b.rs", REPORTER)]);
        let to = files(&[("a.rs", "two\n"), ("src/c.rs", REPORTER)]);
        let direct = DiffTreeBuilder::new(&from, &to, 0.75, false).build_tree();
        let via_free = build_diff_tree(&from, &to, 0.75, false);
        assert_eq!(outcomes(&direct), outcomes(&via_free));
        assert_eq!(all_paths(&direct), all_paths(&via_free));
    }

    /// Rename detection walks sorted paths so the same two packages always
    /// build the same tree; run it enough times to catch a `HashSet` order
    /// leaking back in.
    #[test]
    fn the_same_two_packages_build_the_same_tree_every_time() {
        let from = files(&[
            ("src/a.rs", REPORTER),
            ("src/b.rs", REPORTER),
            ("src/c.rs", REPORTER_EDITED),
        ]);
        let to = files(&[
            ("lib/x.rs", REPORTER),
            ("lib/y.rs", REPORTER),
            ("lib/z.rs", REPORTER_EDITED),
        ]);
        let baseline = build_diff_tree(&from, &to, 0.75, false);
        let first = outcomes(&baseline);
        for _ in 0..20 {
            let again = build_diff_tree(&from, &to, 0.75, false);
            assert_eq!(outcomes(&again), first);
        }
    }
}
