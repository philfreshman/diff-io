import { useEffect, useRef } from "react";

/**
 * [BENCH] Instrumentation only — see philfreshman/diffpack#148: the moment the
 * first file's rows are committed, on the page's own clock, which is the
 * "diff on screen" figure the profile is judged on.
 *
 * Called from `useDiffModel` rather than from `DiffView`: the viewer sits
 * exactly on the cognitive-complexity gate's threshold, and one more hook call
 * there tips it over. It reads only the row count, because the cold path this
 * measures has no earlier file on screen for a pending one to be waiting
 * behind. Delete with the rest of the `[BENCH]` seams.
 */
export function useBenchFirstRows(rowCount: number): void {
	const benched = useRef(false);

	useEffect(() => {
		if (benched.current || rowCount === 0) return;
		benched.current = true;
		console.log(`[BENCH] diff-on-screen ${performance.now().toFixed(1)}ms`);
	}, [rowCount]);
}
