import { type ChangeEvent, useEffect, useState } from "react";

type ThemeOption = {
	value: string;
	label: string;
};

type ThemeGroup = {
	group: string;
	options: ThemeOption[];
};

const THEMES: ThemeGroup[] = [
	{
		group: "Highlight.js Themes",
		options: [
			{ value: "base16/3024", label: "3024" },
			{ value: "atom-one-dark", label: "Atom One Dark" },
			{ value: "atom-one-light", label: "Atom One Light" },
			{ value: "default", label: "Default" },
			{ value: "base16/dracula", label: "Dracula" },
			{ value: "base16/github", label: "GitHub" },
			{ value: "github-dark", label: "GitHub Dark" },
			{ value: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
			{ value: "material", label: "Material" },
			{ value: "monokai", label: "Monokai" },
			{ value: "monokai-sublime", label: "Monokai Sublime" },
			{ value: "night-owl", label: "Night Owl" },
			{ value: "nightfall", label: "Nightfall" },
			{ value: "nord", label: "Nord" },
			{ value: "onedark", label: "One Dark" },
			{ value: "stackoverflow-dark", label: "Stack Overflow Dark" },
			{ value: "stackoverflow-light", label: "Stack Overflow Light" },
			{ value: "solarized-light", label: "Solarized Light" },
			{ value: "solarized-dark", label: "Solarized Dark" },
			{ value: "tokyo-night-dark", label: "Tokyo Night Dark" },
			{ value: "vs", label: "VS" },
			{ value: "vs2015", label: "VS 2015" },
			{ value: "windows-95", label: "Windows 95" },
		],
	},
];

const THEME_STORAGE_KEY = "highlight_theme";

const themes = import.meta.glob<true, string, { default: string }>(
	["/node_modules/highlight.js/styles/**/*.css"],
	{ query: "?raw", eager: true },
);

async function updateHighlightTheme(
	theme: string,
	themeStyle: HTMLStyleElement,
) {
	if (theme === "nightfall") {
		const response = await fetch("/nightfall.css");
		if (!response.ok) {
			console.error("Theme not found: nightfall");
			return;
		}
		themeStyle.textContent = await response.text();
		return;
	}

	const themeKey = Object.keys(themes).find((key) =>
		key.endsWith(`/${theme}.css`),
	);

	const cssModule = themeKey ? themes[themeKey] : undefined;
	if (cssModule) {
		themeStyle.textContent = cssModule.default;
	} else {
		console.error(`Theme not found: ${theme}`);
		const defaultTheme = themes["/node_modules/highlight.js/styles/github.css"];
		if (defaultTheme) {
			themeStyle.textContent = defaultTheme.default;
		}
	}
}

export default function HighlightThemeSelect() {
	const [theme, setTheme] = useState(() => {
		if (typeof document === "undefined") return "github";
		const pageTheme = document.documentElement.getAttribute("data-theme");
		return pageTheme === "dark" ? "github-dark" : "github";
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const storage = window.localStorage;
		if (!storage || typeof storage.getItem !== "function") return;
		const savedTheme = storage.getItem(THEME_STORAGE_KEY);
		if (savedTheme) {
			setTheme(savedTheme);
		}
	}, []);

	useEffect(() => {
		let themeStyle = document.getElementById(
			"highlight-theme-style",
		) as HTMLStyleElement | null;
		if (!themeStyle) {
			themeStyle = document.createElement("style");
			themeStyle.id = "highlight-theme-style";
			document.head.appendChild(themeStyle);
		}
		updateHighlightTheme(theme, themeStyle);
	}, [theme]);

	function handleChange(e: ChangeEvent<HTMLSelectElement>) {
		const newTheme = e.target.value;
		const storage = typeof window !== "undefined" ? window.localStorage : null;
		if (storage && typeof storage.setItem === "function") {
			storage.setItem(THEME_STORAGE_KEY, newTheme);
		}
		setTheme(newTheme);
	}

	return (
		<div className="flex items-center gap-2">
			<label
				htmlFor="highlight-theme"
				className="text-xs text-neutral-500 dark:text-neutral-400"
			>
				Theme:
			</label>
			<select
				id="highlight-theme"
				value={theme}
				onChange={handleChange}
				className="text-xs bg-transparent border-none focus:ring-0 text-neutral-700 dark:text-neutral-300 cursor-pointer"
			>
				{THEMES.map(({ group, options }) => (
					<optgroup key={group} label={group}>
						{options.map(({ value, label }) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</optgroup>
				))}
			</select>
		</div>
	);
}
