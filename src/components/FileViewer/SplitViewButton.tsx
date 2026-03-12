import { useCallback, useEffect, useState } from "react";
import SplitIcon from "../Icons/SplitIcon";
import UnifiedIcon from "../Icons/UnifiedIcon";

const STORAGE_KEY = "split-view-preference";

export default function SplitViewButton({
	onToggle,
}: {
	onToggle?: (value: boolean) => void;
}) {
	const [isSplitView, setIsSplitView] = useState(false);

	const notifyPreference = useCallback(
		(value: boolean) => {
			if (typeof window === "undefined") return;
			window.dispatchEvent(
				new CustomEvent("toggle-split-view", { detail: value }),
			);
			onToggle?.(value);
		},
		[onToggle],
	);

	const persistPreference = useCallback(
		(value: boolean) => {
			if (typeof window === "undefined") return;
			localStorage.setItem(STORAGE_KEY, String(value));
			notifyPreference(value);
		},
		[notifyPreference],
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const stored = localStorage.getItem(STORAGE_KEY);
		const initial = stored === "true";
		setIsSplitView(initial);
		notifyPreference(initial);
	}, [notifyPreference]);

	const handleClick = () => {
		const next = !isSplitView;
		setIsSplitView(next);
		persistPreference(next);
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			title={isSplitView ? "Switch to unified view" : "Switch to split view"}
			className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
		>
			{isSplitView ? <UnifiedIcon /> : <SplitIcon />}
		</button>
	);
}
