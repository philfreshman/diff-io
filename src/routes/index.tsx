import { createFileRoute } from "@tanstack/react-router";
import { RegistryGrid } from "#/components/landing/RegistryGrid.tsx";
import { StarField } from "#/components/landing/StarField.tsx";
import { GithubIcon } from "#/components/ui/icons.tsx";
import styles from "./index.module.css";

const DESCRIPTION =
	"Compare package versions across ecosystems. Source-aware dependency review for npm, crates.io, Go and PyPI.";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [{ name: "description", content: DESCRIPTION }],
	}),
	component: Home,
});

function Home() {
	return (
		<>
			{/* The night sky belongs to the landing page: the workspace pages are for
			    reading diffs, and a pulsing background competes with them. */}
			<div className={styles.cosmos} aria-hidden="true" data-testid="cosmos" />
			<StarField />
			<main className={styles.page}>
				<header className={styles.intro}>
					<h1 className={styles.title}>diffpack</h1>
					<p className={styles.tagline}>
						Compare package versions across ecosystems.
						<br />
						Clean. Fast. Source-aware.
					</p>
				</header>

				<RegistryGrid />

				<footer className={styles.footer}>
					<p className={styles.footerText}>
						More registries coming soon.
						<a
							className={styles.repoLink}
							href="https://github.com/philfreshman/diffpack"
							target="_blank"
							rel="noopener noreferrer"
						>
							<GithubIcon width="14" height="14" />
							<span className={styles.linkLabel}>diffpack on GitHub</span>
						</a>
					</p>
				</footer>
			</main>
		</>
	);
}
