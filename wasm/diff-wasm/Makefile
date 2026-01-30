WASM_PKG_DIR ?= pkg
WASM_BG ?= $(WASM_PKG_DIR)/diff_wasm_bg.wasm

build-wasm:
	wasm-pack build --release --target web

wasm-opt:
	wasm-opt -O3 $(WASM_BG) -o $(WASM_BG)

build-wasm-opt: build-wasm wasm-opt
