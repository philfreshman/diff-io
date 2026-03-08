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

export function applyTheme(doc?: Document) {
	if (typeof document === "undefined") return;
	const activeDoc = doc || document;
	const selection = getThemeSelection();
	const resolved = getResolvedTheme();
	activeDoc.documentElement.setAttribute("data-theme", resolved);
	activeDoc.documentElement.setAttribute("data-theme-selection", selection);
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
	document.addEventListener("astro:before-swap", (e: any) =>
		applyTheme(e.newDocument),
	);
	window
		.matchMedia("(prefers-color-scheme: dark)")
		.addEventListener("change", () => {
			if (getThemeSelection() === "system") applyTheme();
		});
}
