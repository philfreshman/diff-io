export type ThemeSelection = "light" | "dark" | "system";

export function getResolvedTheme(): "light" | "dark" {
	const selection = getThemeSelection();
	if (selection !== "system") return selection;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function getThemeSelection(): ThemeSelection {
	return (localStorage.getItem("theme") as ThemeSelection) || "dark";
}

/**
 * Tints the mobile browser chrome (iOS Safari status/toolbar) so it blends with
 * the page instead of falling back to its default grey. Mirrors the pre-paint
 * script in BaseHead.astro, which owns the initial value.
 */
function applyThemeColor(activeDoc: Document, resolved: "light" | "dark") {
	const head = activeDoc.head;
	if (!head) return;
	let meta = head.querySelector('meta[name="theme-color"]');
	if (!meta) {
		meta = activeDoc.createElement("meta");
		meta.setAttribute("name", "theme-color");
		head.appendChild(meta);
	}
	meta.setAttribute("content", resolved === "light" ? "#ffffff" : "#0a0a0a");
}

export function applyTheme(doc?: Document) {
	if (typeof document === "undefined") return;
	const activeDoc = doc || document;
	const selection = getThemeSelection();
	const resolved = getResolvedTheme();
	activeDoc.documentElement.setAttribute("data-theme", resolved);
	activeDoc.documentElement.setAttribute("data-theme-selection", selection);
	applyThemeColor(activeDoc, resolved);
}

export function cycleTheme(): ThemeSelection {
	const themes: ThemeSelection[] = ["light", "dark", "system"];
	const current = getThemeSelection();
	const next = themes[(themes.indexOf(current) + 1) % themes.length];
	localStorage.setItem("theme", next);
	applyTheme();
	return next;
}

if (typeof window !== "undefined") {
	applyTheme();
	type AstroBeforeSwapEvent = Event & { newDocument: Document };
	document.addEventListener("astro:before-swap", (event) => {
		const beforeSwapEvent = event as AstroBeforeSwapEvent;
		if (beforeSwapEvent.newDocument) {
			applyTheme(beforeSwapEvent.newDocument);
		}
	});
	window
		.matchMedia("(prefers-color-scheme: dark)")
		.addEventListener("change", () => {
			if (getThemeSelection() === "system") applyTheme();
		});
}
