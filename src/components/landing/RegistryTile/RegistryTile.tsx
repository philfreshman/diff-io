import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "#/components/ui/icons.tsx";
import type { RegistryAdapter } from "#/lib/registries/types.ts";
import styles from "./RegistryTile.module.css";

/**
 * One registry, as a single link to its workspace. The accent is picked by
 * `data-registry` from the theme's tokens rather than carried on the adapter,
 * so a colour change is a stylesheet change.
 */
export function RegistryTile({ adapter }: { adapter: RegistryAdapter }) {
	return (
		<Link
			to="/$registry"
			params={{ registry: adapter.id }}
			className={styles.tile}
			data-registry={adapter.id}
			data-testid="registry-tile"
		>
			<h2 className={styles.name}>{adapter.label}</h2>
			<p className={styles.tagline}>{adapter.tagline}</p>
			<span className={styles.explore}>
				Explore
				<ArrowRightIcon className={styles.arrow} width="16" height="16" />
			</span>
		</Link>
	);
}
