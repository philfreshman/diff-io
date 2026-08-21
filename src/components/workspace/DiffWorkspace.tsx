import type { DiffSlug } from "#/lib/url/slug.ts";
import { WorkspaceHeader } from "./WorkspaceHeader.tsx";
import styles from "./DiffWorkspace.module.css";

/**
 * The workspace shell. The header is real; the body still only prints the
 * parsed slug, which is how the routing suite proves the route hands its
 * component a fully parsed URL with no client-side re-derivation. Task 9
 * replaces the body with the tree and the diff.
 */
export function DiffWorkspace({ slug }: { slug: DiffSlug }) {
	return (
		<div className={styles.workspace}>
			<WorkspaceHeader slug={slug} />
			<main className={styles.body}>
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
		</div>
	);
}
