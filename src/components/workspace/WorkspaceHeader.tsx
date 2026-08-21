import { Link } from "@tanstack/react-router";
import { requireAdapter } from "#/lib/registries/index.ts";
import type { DiffSlug } from "#/lib/url/slug.ts";
import { PackageCombobox } from "./PackageCombobox.tsx";
import styles from "./WorkspaceHeader.module.css";

/**
 * Always mounted, whatever the URL says: the header is how a comparison is
 * assembled, so it exists before there is anything to compare. Version
 * selectors and Compare join it in task 8.
 */
export function WorkspaceHeader({ slug }: { slug: DiffSlug }) {
	const adapter = requireAdapter(slug.registry);

	return (
		<header className={styles.header}>
			<Link className={styles.logo} to="/">
				diffpack
			</Link>
			<div className={styles.controls}>
				<PackageCombobox adapter={adapter} selected={slug.package} />
			</div>
		</header>
	);
}
