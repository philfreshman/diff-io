import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/Button/Button.tsx";
import type { RegistryAdapter } from "#/lib/registries/types.ts";
import { buildPath, type DiffSlug } from "#/lib/url/slug.ts";
import { diffClient } from "#/lib/worker/diffWorkerClient.ts";
import { resolveSelection } from "./versionSelection.ts";
import { useVersions } from "./useVersions.ts";
import { VersionCombobox } from "./VersionCombobox.tsx";
import styles from "./VersionControls.module.css";

/**
 * The two version fields and the Compare button.
 *
 * Choosing a version does **not** write the URL. The URL is the request for a
 * comparison — task 9 starts the engine from it — and a comparison costs two
 * archive downloads, so it is made when the user asks for one. Compare is that
 * ask, and the address it writes is exactly what a deep link into the same
 * comparison would be.
 */
export function VersionControls({
	adapter,
	slug,
}: {
	adapter: RegistryAdapter;
	slug: DiffSlug;
}) {
	const navigate = useNavigate();
	const { list, loading } = useVersions(adapter, slug.package);
	const [selection, setSelection] = useState(() =>
		resolveSelection(list, slug),
	);

	// The fields follow the URL and the list: a deep link's versions, a new
	// package's defaults, back/forward. Only a selection made here overrides
	// them, and it lasts until one of those changes underneath it.
	useEffect(() => {
		setSelection(resolveSelection(list, { from: slug.from, to: slug.to }));
	}, [list, slug.from, slug.to]);

	const { from, to } = selection;
	const ready = Boolean(slug.package && from && to);
	// A version pair changing does not invalidate the open file: it is the same
	// package, and a path that is gone from the new pair reads as removed.
	const target = buildPath(adapter, {
		package: slug.package,
		from,
		to,
		file: slug.file,
	});

	// Hovering Compare is a good guess, not a promise, so the worker is asked
	// once per pair and its failures stay silent — the click is where an error
	// has somewhere to be shown.
	const prefetched = useRef(new Set<string>());
	function prefetch() {
		if (!ready || prefetched.current.has(target)) return;
		prefetched.current.add(target);
		diffClient
			.prefetch({ registry: adapter.id, pkg: slug.package, from, to })
			.catch(() => prefetched.current.delete(target));
	}

	return (
		<>
			<VersionCombobox
				label="From Version"
				versions={list}
				value={from}
				onChange={(version) =>
					setSelection((current) => ({ ...current, from: version }))
				}
				loading={loading}
				downloadUrl={from ? adapter.downloadUrl(slug.package, from) : undefined}
			/>
			<VersionCombobox
				label="To Version"
				versions={list}
				value={to}
				onChange={(version) =>
					setSelection((current) => ({ ...current, to: version }))
				}
				loading={loading}
				downloadUrl={to ? adapter.downloadUrl(slug.package, to) : undefined}
			/>
			<Button
				className={styles.compare}
				variant="primary"
				disabled={!ready}
				onClick={() => navigate({ to: target })}
				onMouseEnter={prefetch}
				onFocus={prefetch}
			>
				Compare
			</Button>
		</>
	);
}
