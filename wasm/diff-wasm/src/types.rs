use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus {
    Added,
    Removed,
    Modified,
    Unchanged,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMapEntry {
    #[serde(rename = "type")]
    pub file_type: FileType,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(rename = "type")]
    pub file_type: FileType,
    pub status: DiffStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DiffFileEntry>>,
}

/// The tree these types serialise to is read by TypeScript, against the
/// checked-in declaration in `wasm/diff-wasm/types/`. The names and the
/// omissions below are that contract; a rename here is a breaking change on
/// the other side, so it is pinned rather than left to the derive.
#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> DiffFileEntry {
        DiffFileEntry {
            path: "src/a.rs".to_string(),
            old_path: None,
            file_type: FileType::File,
            status: DiffStatus::Modified,
            added: Some(2),
            removed: Some(1),
            children: None,
        }
    }

    #[test]
    fn a_status_serialises_lowercase() {
        for (status, expected) in [
            (DiffStatus::Added, "\"added\""),
            (DiffStatus::Removed, "\"removed\""),
            (DiffStatus::Modified, "\"modified\""),
            (DiffStatus::Unchanged, "\"unchanged\""),
            (DiffStatus::Renamed, "\"renamed\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), expected);
        }
    }

    #[test]
    fn a_file_type_serialises_lowercase() {
        assert_eq!(serde_json::to_string(&FileType::File).unwrap(), "\"file\"");
        assert_eq!(
            serde_json::to_string(&FileType::Directory).unwrap(),
            "\"directory\""
        );
    }

    /// `type` and `oldPath`: the field is named for Rust on this side and for
    /// JavaScript on the other.
    #[test]
    fn a_tree_entry_serialises_with_the_names_typescript_reads() {
        let json = serde_json::to_value(entry()).unwrap();
        assert_eq!(json["path"], "src/a.rs");
        assert_eq!(json["type"], "file");
        assert_eq!(json["status"], "modified");
        assert_eq!(json["added"], 2);
        assert_eq!(json["removed"], 1);
    }

    /// The optional fields are omitted rather than sent as `null`, which is
    /// what lets the TypeScript side declare them optional.
    #[test]
    fn absent_optional_fields_are_left_out_entirely() {
        let json = serde_json::to_value(entry()).unwrap();
        for field in ["oldPath", "children"] {
            assert!(json.get(field).is_none(), "{field} should be omitted");
        }
    }

    #[test]
    fn a_rename_carries_its_old_path_and_a_directory_its_children() {
        let node = DiffFileEntry {
            path: "src".to_string(),
            old_path: None,
            file_type: FileType::Directory,
            status: DiffStatus::Modified,
            added: Some(2),
            removed: Some(1),
            children: Some(vec![DiffFileEntry {
                old_path: Some("src/b.rs".to_string()),
                status: DiffStatus::Renamed,
                ..entry()
            }]),
        };
        let json = serde_json::to_value(node).unwrap();
        assert_eq!(json["type"], "directory");
        assert_eq!(json["children"][0]["oldPath"], "src/b.rs");
        assert_eq!(json["children"][0]["status"], "renamed");
    }

    /// The entry types round-trip: `tests/web.rs` deserialises the tree it
    /// just built, so the derive has to work in both directions.
    #[test]
    fn a_tree_entry_round_trips() {
        let json = serde_json::to_string(&entry()).unwrap();
        let back: DiffFileEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.path, "src/a.rs");
        assert_eq!(back.status, DiffStatus::Modified);
        assert!(matches!(back.file_type, FileType::File));
        assert_eq!(back.old_path, None);
    }

    #[test]
    fn a_file_map_entry_round_trips() {
        let entry = FileMapEntry {
            file_type: FileType::File,
            content: "body\n".to_string(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["type"], "file");
        assert_eq!(json["content"], "body\n");

        let back: FileMapEntry = serde_json::from_value(json).unwrap();
        assert_eq!(back.content, "body\n");
    }
}
