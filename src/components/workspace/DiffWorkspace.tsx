import type { DiffSlug } from "#/lib/url/slug.ts";
import styles from "./DiffWorkspace.module.css";

/**
 * Placeholder for the real workspace (task 9): it exists to prove the route
 * hands its component a fully parsed slug, with no client-side re-derivation.
 */
export function DiffWorkspace({ slug }: { slug: DiffSlug }) {
	return (
		<main className={styles.workspace}>
			<h1 className={styles.heading}>{slug.registry}</h1>
			<dl className={styles.selection}>
				<dt>package</dt>
				<dd data-testid="slug-package">{slug.package}</dd>
				<dt>from</dt>
				<dd data-testid="slug-from">{slug.from}</dd>
				<dt>to</dt>
				<dd data-testid="slug-to">{slug.to}</dd>
				<dt>file</dt>
				<dd data-testid="slug-file">{slug.file}</dd>
			</dl>
		</main>
	);
}
