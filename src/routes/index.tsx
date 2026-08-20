import { createFileRoute } from "@tanstack/react-router";
import styles from "./index.module.css";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className={styles.page}>
			<h1 className={styles.title}>diffpack</h1>
			<p className={styles.tagline}>
				Compare package versions across ecosystems.
			</p>
		</main>
	);
}
