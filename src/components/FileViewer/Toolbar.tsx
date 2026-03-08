import { useEffect, useState } from "react";
import FoldIcon from "../Icons/FoldIcon";
import UnfoldIcon from "../Icons/UnfoldIcon";
import SplitViewButton from "./SplitViewButton";
import ThemeSelect from "./ThemeSelect.js";

export default function Toolbar() {
	const [isExpanded, setIsExpanded] = useState(false);

	const handleExpandToggle = () => {
		const next = !isExpanded;
		setIsExpanded(next);
		window.dispatchEvent(
			new CustomEvent(next ? "expand-all-diff" : "fold-all-diff"),
		);
	};

	useEffect(() => {
		const handleFileDiff = () => setIsExpanded(false);
		window.addEventListener("file-diff", handleFileDiff);
		return () => window.removeEventListener("file-diff", handleFileDiff);
	}, []);

	useEffect(() => {
		window.dispatchEvent(new CustomEvent("toolbar-ready"));
	}, []);

	return (
		<div className="w-full h-9.5 mb-3 bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 rounded-md flex items-center px-3 justify-between">
			<div className="flex items-center gap-4">
				<div className="flex items-center gap-2 border-r border-neutral-300 dark:border-neutral-700 pr-4 mr-2">
					<button
						type="button"
						onClick={handleExpandToggle}
						title={isExpanded ? "Fold all" : "Expand all"}
						className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 transition-colors"
					>
						{isExpanded ? <FoldIcon /> : <UnfoldIcon />}
					</button>
					<SplitViewButton />
				</div>
				<div
					id="diff-filename"
					className="text-sm font-semibold text-neutral-900 dark:text-white"
				/>
			</div>
			<ThemeSelect />
		</div>
	);
}
