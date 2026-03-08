import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
	cycleTheme,
	getThemeSelection,
	type ThemeSelection,
} from "../../utils/theme.ts";
import MoonIcon from "../Icons/MoonIcon.tsx";
import SunIcon from "../Icons/SunIcon.tsx";
import SystemIcon from "../Icons/SystemIcon.tsx";

const ICON_MAP: Record<ThemeSelection, React.ReactNode> = {
	light: <SunIcon />,
	dark: <MoonIcon />,
	system: <SystemIcon />,
};

const LABEL_MAP: Record<ThemeSelection, string> = {
	light: "Switch to dark theme",
	dark: "Switch to system theme",
	system: "Switch to light theme",
};

export default function ThemeToggle() {
	const [selection, setSelection] = useState<ThemeSelection>("dark");

	useEffect(() => {
		setSelection(getThemeSelection());
	}, []);

	const handleClick = useCallback(() => {
		setSelection(cycleTheme());
	}, []);

	return (
		<button
			type="button"
			onClick={handleClick}
			aria-label={LABEL_MAP[selection]}
			className="
				absolute top-2 right-3 z-10
				p-2 rounded-lg cursor-pointer border-0
				text-current bg-transparent
				transition-colors duration-150
				hover:bg-black/5
				dark:hover:bg-white/10
      "
		>
			{ICON_MAP[selection]}
		</button>
	);
}
