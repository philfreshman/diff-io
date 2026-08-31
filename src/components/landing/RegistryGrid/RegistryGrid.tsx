import { registryAdapters } from "#/lib/registries/index.ts";
import { RegistryTile } from "../RegistryTile/RegistryTile.tsx";
import styles from "./RegistryGrid.module.css";

/**
 * Every registry diffpack supports, in the order the adapter list gives them.
 * Adding a registry adds a tile; there is no second list to keep in step.
 */
export function RegistryGrid() {
	return (
		<ul className={styles.grid}>
			{registryAdapters.map((adapter) => (
				<li key={adapter.id}>
					<RegistryTile adapter={adapter} />
				</li>
			))}
		</ul>
	);
}
