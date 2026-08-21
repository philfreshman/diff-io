import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Combobox } from "#/components/ui/Combobox/Combobox.tsx";

export const Route = createFileRoute("/spike-combobox")({
	component: ComboboxSpike,
});

const VERSIONS = ["5.1.0", "5.0.1", "4.18.2", "4.17.3", "4.16.0"];

/** Stands in for search results: whatever the query, the server sent these. */
const RESULTS = [
	{ name: "express", description: "Fast, unopinionated web framework" },
	{ name: "expressive", description: "Something else entirely" },
];

/**
 * Test harness for the `Combobox` primitive: it has no real call site until
 * task 7 (`feature/package-search`) and task 8 (`feature/version-selectors`),
 * and its keyboard matrix can only be driven in a real browser.
 *
 * Removed alongside `spike.tsx` once those two land. It is a sibling of
 * `/spike` rather than a child: a flat `spike.combobox.tsx` would make
 * `spike.tsx` its parent layout, and that route renders no `<Outlet/>`.
 */
function ComboboxSpike() {
	const [inputValue, setInputValue] = useState("");
	const [selected, setSelected] = useState("");
	const [submitted, setSubmitted] = useState("");
	const [loading, setLoading] = useState(false);
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState("");

	return (
		<main style={{ padding: "2rem", maxWidth: "24rem" }}>
			<Combobox
				label="Version"
				items={VERSIONS}
				inputValue={inputValue}
				onInputValueChange={setInputValue}
				onSelect={(item) => {
					setSelected(item);
					setInputValue(item);
				}}
				onSubmitText={setSubmitted}
				itemToText={(item) => item}
				loading={loading}
				placeholder="Version"
			/>
			<Combobox
				label="Package"
				items={RESULTS}
				inputValue={query}
				onInputValueChange={setQuery}
				onSelect={(item) => setPicked(item.name)}
				itemToText={(item) => item.name}
				renderItem={(item) => (
					<>
						<strong>{item.name}</strong>
						<span>{item.description}</span>
					</>
				)}
				// The search API answered the query; filtering again here would hide
				// results that do not literally contain what was typed.
				filter={null}
				placeholder="Package"
			/>
			<p data-testid="picked">{picked}</p>
			<p data-testid="selected">{selected}</p>
			<p data-testid="submitted">{submitted}</p>
			<button type="button" onClick={() => setLoading((it) => !it)}>
				toggle loading
			</button>
		</main>
	);
}
