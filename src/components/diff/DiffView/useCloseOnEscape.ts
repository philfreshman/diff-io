import { useEffect, useRef } from "react";

/**
 * Escape closes the file. It is read from the document rather than from the
 * viewer because the viewer is not what has focus while a file is being read
 * — but a field's Escape is the field's own (it closes a combobox's list), so
 * one typed into is left alone.
 */
export function useCloseOnEscape(onClose: () => void): void {
	const close = useRef(onClose);
	close.current = onClose;

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || isField(event.target)) return;
			event.preventDefault();
			close.current();
		}

		document.addEventListener("keydown", onKeyDown);

		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);
}

function isField(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;

	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
	);
}
