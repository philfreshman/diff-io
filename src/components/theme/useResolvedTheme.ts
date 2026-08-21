import { useEffect, useState } from "react";
import { readAppliedTheme, type ResolvedTheme } from "#/lib/theme.ts";

/**
 * The theme as it is on the document right now, or `null` until mounted: the
 * server cannot know it, and rendering a guess would be a hydration mismatch.
 * The toggle changes `data-theme` in place, so this watches the attribute
 * rather than reading it once.
 */
export function useResolvedTheme(): ResolvedTheme | null {
	const [theme, setTheme] = useState<ResolvedTheme | null>(null);

	useEffect(() => {
		const read = () => setTheme(readAppliedTheme(document));
		read();

		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		return () => observer.disconnect();
	}, []);

	return theme;
}
