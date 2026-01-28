mod types;
mod core;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use crate::types::FileMapEntry;

#[wasm_bindgen]
pub struct DiffCounts {
    pub added: usize,
    pub removed: usize,
}

#[wasm_bindgen]
pub fn count_diff(from: &str, to: &str) -> DiffCounts {
    let counts = core::count_diff(from, to);
    DiffCounts {
        added: counts.added,
        removed: counts.removed,
    }
}

#[wasm_bindgen]
pub fn get_diff_content(filename: &str, from_content: &str, to_content: &str) -> String {
    core::get_diff_content(filename, from_content, to_content)
}

#[wasm_bindgen]
pub struct DiffTreeBuilder {
    inner: core::DiffTreeBuilder,
}

#[wasm_bindgen]
impl DiffTreeBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new(similarity_threshold: f64) -> Self {
        Self {
            inner: core::DiffTreeBuilder::new(similarity_threshold),
        }
    }

    pub fn set_from_files(&mut self, files: JsValue) -> Result<(), JsValue> {
        let map: HashMap<String, FileMapEntry> = serde_wasm_bindgen::from_value(files)?;
        self.inner.set_from_files(map);
        Ok(())
    }

    pub fn set_to_files(&mut self, files: JsValue) -> Result<(), JsValue> {
        let map: HashMap<String, FileMapEntry> = serde_wasm_bindgen::from_value(files)?;
        self.inner.set_to_files(map);
        Ok(())
    }

    pub fn build_tree(&self) -> Result<JsValue, JsValue> {
        let tree = self.inner.build_tree();
        Ok(serde_wasm_bindgen::to_value(&tree)?)
    }
}

#[wasm_bindgen]
pub fn build_diff_tree(
    from_files: JsValue,
    to_files: JsValue,
    similarity_threshold: f64,
) -> Result<JsValue, JsValue> {
    let from_map: HashMap<String, FileMapEntry> = serde_wasm_bindgen::from_value(from_files)?;
    let to_map: HashMap<String, FileMapEntry> = serde_wasm_bindgen::from_value(to_files)?;
    let tree = core::build_diff_tree(from_map, to_map, similarity_threshold);
    Ok(serde_wasm_bindgen::to_value(&tree)?)
}
