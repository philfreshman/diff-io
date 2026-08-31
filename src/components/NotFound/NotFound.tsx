import { Link } from "@tanstack/react-router";
import styles from "./NotFound.module.css";

export function NotFound() {
	return (
		<main className={styles.notFound} data-testid="not-found">
			<h1 className={styles.heading}>Nothing here</h1>
			<p className={styles.message}>
				diffpack compares packages on npm, crates.io, Go and PyPI.
			</p>
			<Link to="/">Back to the registries</Link>
		</main>
	);
}
