import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-2">
			<h1 className="text-4xl font-bold tracking-tight">diffpack</h1>
			<p className="text-neutral-500 dark:text-neutral-400">
				Compare package versions across ecosystems.
			</p>
		</main>
	);
}
