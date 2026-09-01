import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import {
	type DiffSessionState,
	diffSession,
} from "#/lib/session/diffSession.ts";
import type { DiffSlug } from "#/lib/url/slug.ts";

/**
 * Binds the URL to the engine: an address holding a package and two versions
 * *is* the request for a comparison, and the file segment is the request for
 * one file of it. Nothing else starts the engine — a deep link, a Compare
 * click and the back button are the same event by construction.
 */
export function useDiffSession(
	slug: DiffSlug,
	ignoreWhitespace: boolean | null,
): DiffSessionState {
	const state = useSelector(diffSession.store, (it) => it);
	const { registry, package: pkg, from, to, file } = slug;
	const comparable = Boolean(pkg && from && to);

	// `null` is not an answer to the whitespace question, only the absence of
	// one: starting on a guess would build every deep link's tree twice over
	// when the stored answer turns out to be the other one.
	useEffect(() => {
		if (!comparable) diffSession.reset();
		else if (ignoreWhitespace !== null)
			diffSession.start({ registry, pkg, from, to, ignoreWhitespace });
	}, [comparable, registry, pkg, from, to, ignoreWhitespace]);

	// The tree has to exist before a path in it can be read, so opening waits
	// for `ready` and then re-runs for whatever file the URL names by then.
	useEffect(() => {
		if (state.status === "ready" || !file) diffSession.openFile(file);
	}, [state.status, file]);

	return state;
}
