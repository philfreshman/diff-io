use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use similar::{ChangeTag, TextDiff};
use crate::types::{DiffFileEntry, DiffStatus, FileMapEntry, FileType};

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
    from_file_paths: HashSet<String>,
    to_file_paths: HashSet<String>,
    from_dirs: HashSet<String>,
    to_dirs: HashSet<String>,
    similarity_threshold: f64,
}

impl DiffTreeBuilder {
    pub fn new(similarity_threshold: f64) -> Self {
        Self {
            from_files: HashMap::new(),
            to_files: HashMap::new(),
            from_file_paths: HashSet::new(),
            to_file_paths: HashSet::new(),
            from_dirs: HashSet::new(),
            to_dirs: HashSet::new(),
            similarity_threshold: similarity_threshold.max(0.0).min(1.0),
        }
    }

    pub fn set_from_files(&mut self, files: HashMap<String, FileMapEntry>) {
        self.from_files = files;
        self.from_file_paths = self.collect_file_paths(&self.from_files);
        self.from_dirs = self.collect_directories(&self.from_files);
    }

    pub fn set_to_files(&mut self, files: HashMap<String, FileMapEntry>) {
        self.to_files = files;
        self.to_file_paths = self.collect_file_paths(&self.to_files);
        self.to_dirs = self.collect_directories(&self.to_files);
    }

    pub fn build_tree(&self) -> DiffFileEntry {
        // 1. Identify added/removed files
        let from_paths: HashSet<_> = self.from_files.keys().cloned().collect();
        let to_paths: HashSet<_> = self.to_files.keys().cloned().collect();

        let deleted: Vec<_> = self
            .from_file_paths
            .difference(&self.to_file_paths)
            .cloned()
            .collect();
        let added: Vec<_> = self
            .to_file_paths
            .difference(&self.from_file_paths)
            .cloned()
            .collect();

        // 2. Detect renames
        let renames = self.detect_renames_optimized(&deleted, &added);

        // 3. Build tree structure
        let tree =
            self.build_tree_structure(&from_paths, &to_paths, &self.from_dirs, &self.to_dirs);

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

        let mut nodes: HashMap<String, DiffFileEntry> = HashMap::new();
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

        for path in &all_paths {
            if path == "/" {
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
