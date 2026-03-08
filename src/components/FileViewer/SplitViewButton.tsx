import { useCallback, useEffect, useState } from "react";
import SplitIcon from "../Icons/SplitIcon";
import UnifiedIcon from "../Icons/UnifiedIcon";

const STORAGE_KEY = "split-view-preference";

export default function SplitViewButton({
	onToggle,
}: {
	onToggle?: (value: boolean) => void;
}) {
	const [isSplitView, setIsSplitView] = useState(() => {
		if (typeof window !== "undefined") {
			return localStorage.getItem(STORAGE_KEY) === "true";
		}
		return false;
	});

	const applyPreference = useCallback(
		(value: boolean) => {
			localStorage.setItem(STORAGE_KEY, String(value));
			window.dispatchEvent(
				new CustomEvent("toggle-split-view", { detail: value }),
			);
			onToggle?.(value);
		},
		[onToggle],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Run only once
	useEffect(() => {
		applyPreference(isSplitView);
	}, []);

	const handleClick = () => {
		const next = !isSplitView;
		setIsSplitView(next);
		applyPreference(next);
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
