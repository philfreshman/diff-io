use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use similar::{ChangeTag, TextDiff};
use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};

pub struct DiffCounts {
    pub added: usize,
    pub removed: usize,
}

pub fn count_diff(from: &str, to: &str) -> DiffCounts {
    let from_lines: Vec<&str> = from.split('\n').collect();
    let to_lines: Vec<&str> = to.split('\n').collect();
    let diff = TextDiff::from_slices(&from_lines, &to_lines);
    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Delete => removed += 1,
            ChangeTag::Insert => added += 1,
            _ => {}
        }
    }
    DiffCounts { added, removed }
}

pub fn get_diff_content(filename: &str, from_content: &str, to_content: &str) -> String {
    let from_lines: Vec<&str> = from_content.split('\n').collect();
    let to_lines: Vec<&str> = to_content.split('\n').collect();
    let diff = TextDiff::from_slices(&from_lines, &to_lines);
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
        result.push_str(change.value());
    }
    result
}

pub struct DiffTreeBuilder {
    from_files: HashMap<String, FileMapEntry>,
    to_files: HashMap<String, FileMapEntry>,
    similarity_threshold: f64,
}

impl DiffTreeBuilder {
    pub fn new(similarity_threshold: f64) -> Self {
        Self {
            from_files: HashMap::new(),
            to_files: HashMap::new(),
            similarity_threshold: similarity_threshold.max(0.0).min(1.0),
        }
    }

    pub fn set_from_files(&mut self, files: HashMap<String, FileMapEntry>) {
        self.from_files = files;
    }

    pub fn set_to_files(&mut self, files: HashMap<String, FileMapEntry>) {
        self.to_files = files;
    }

    pub fn build_tree(&self) -> DiffFileEntry {
        // 1. Identify added/removed files
        let from_paths: HashSet<_> = self.from_files.keys().cloned().collect();
        let to_paths: HashSet<_> = self.to_files.keys().cloned().collect();

        let from_file_paths = self.collect_file_paths(&self.from_files);
        let to_file_paths = self.collect_file_paths(&self.to_files);

        let deleted: Vec<_> = from_file_paths.difference(&to_file_paths).cloned().collect();
        let added: Vec<_> = to_file_paths.difference(&from_file_paths).cloned().collect();

        // 2. Detect renames
        let renames = self.detect_renames_optimized(&deleted, &added);

        // 3. Build tree structure
        let from_dirs = self.collect_directories(&self.from_files);
        let to_dirs = self.collect_directories(&self.to_files);
        let tree = self.build_tree_structure(&from_paths, &to_paths, &from_dirs, &to_dirs);

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

        // Phase 1: Exact content matches using hash-based lookup (O(n+m) instead of O(n*m))
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

                        // Verify content match (hash collision check)
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

        // Phase 2: Similar content (using similar crate)
        for add_path in added {
            if renames.contains_key(add_path) {
                continue;
            }

            let add_content = match self.file_content(&self.to_files, add_path) {
                Some(c) => c,
                None => continue,
            };

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

                // Quick filter
                if !self.can_be_similar(del_content, add_content) {
                    continue;
                }

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
    ) -> DiffFileEntry {
        // Merge all paths
        let mut all_paths = HashSet::new();
        all_paths.extend(from_paths.iter().cloned());
        all_paths.extend(to_paths.iter().cloned());
        all_paths.extend(from_dirs.iter().cloned());
        all_paths.extend(to_dirs.iter().cloned());

        // Sort paths for consistent tree building
        let mut sorted_paths: Vec<_> = all_paths.into_iter().collect();
        sorted_paths.sort();

        // Build root node
        let mut root = DiffFileEntry {
            path: "/".to_string(),
            old_path: None,
            file_type: FileType::Directory,
            status: DiffStatus::Unchanged,
            added: None,
            removed: None,
            children: Some(Vec::new()),
        };

        // Insert each path into the tree
        for path in sorted_paths {
            let file_type = self.resolve_file_type(&path, from_dirs, to_dirs);

            self.insert_node(&mut root, &path, file_type);
        }

        root
    }

    fn collect_directories(&self, entries: &HashMap<String, FileMapEntry>) -> HashSet<String> {
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

    fn insert_node(&self, root: &mut DiffFileEntry, path: &str, file_type: FileType) {
        let parts: Vec<&str> = path.split('/').collect();
        let mut current = root;

        for (i, _part) in parts.iter().enumerate() {
            let current_path = parts[..=i].join("/");
            let is_leaf = i == parts.len() - 1;

            // Get or create children vec
            let children = current.children.as_mut().unwrap();

            // Find or create the child node - use binary search on sorted children for better performance
            let child_pos = children.iter().position(|c| c.path == current_path);

            if let Some(pos) = child_pos {
                current = &mut children[pos];
            } else {
                let new_node = DiffFileEntry {
                    path: current_path.clone(),
                    old_path: None,
                    file_type: if is_leaf {
                        file_type.clone()
                    } else {
                        FileType::Directory
                    },
                    status: DiffStatus::Unchanged,
                    added: None,
                    removed: None,
                    children: Some(Vec::new()),
                };
                children.push(new_node);
                // Sort children for consistent ordering and potential binary search optimization
                children.sort_by(|a, b| a.path.cmp(&b.path));
                let pos = children.iter().position(|c| c.path == current_path).unwrap();
                current = &mut children[pos];
            }
        }
    }

    fn compute_tree_stats(
        &self,
        mut root: DiffFileEntry,
        renames: &HashMap<String, String>,
    ) -> DiffFileEntry {
        let from_dirs = self.collect_directories(&self.from_files);
        let to_dirs = self.collect_directories(&self.to_files);

        self.compute_node_stats(&mut root, renames, &from_dirs, &to_dirs);
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
                            node.status = DiffStatus::Modified;
                            let (added, removed) = self.count_diff(from, to);
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

    fn count_diff(&self, from: &str, to: &str) -> (u32, u32) {
        let diff = TextDiff::from_lines(from, to);

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

    fn collect_file_paths(&self, entries: &HashMap<String, FileMapEntry>) -> HashSet<String> {
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

    fn file_content<'a>(
        &self,
        entries: &'a HashMap<String, FileMapEntry>,
        path: &str,
    ) -> Option<&'a str> {
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
    from_files: HashMap<String, FileMapEntry>,
    to_files: HashMap<String, FileMapEntry>,
    similarity_threshold: f64,
) -> DiffFileEntry {
    let mut builder = DiffTreeBuilder::new(similarity_threshold);
    builder.set_from_files(from_files);
    builder.set_to_files(to_files);
    builder.build_tree()
}
