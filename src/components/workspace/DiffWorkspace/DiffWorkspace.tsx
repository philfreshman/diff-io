import { useNavigate } from "@tanstack/react-router";
import { DiffView } from "#/components/diff/DiffView/DiffView.tsx";
import { useDiffView } from "#/components/diff/useDiffView.ts";
import { TreePanel } from "#/components/tree/TreePanel/TreePanel.tsx";
import { Spinner } from "#/components/ui/Spinner/Spinner.tsx";
import { requireAdapter } from "#/lib/registries/index.ts";
import { flattenFiles } from "#/lib/session/tree.ts";
import { buildPath, type DiffSlug } from "#/lib/url/slug.ts";
import { useDiffSession } from "../useDiffSession.ts";
import { WorkspaceHeader } from "../WorkspaceHeader/WorkspaceHeader.tsx";
import styles from "./DiffWorkspace.module.css";

/**
 * The workspace shell: the header assembles a comparison, the body shows the
 * one the URL already names.
 *
 * Opening a file is a URL write like any other navigation, and how much of a
 * file is open lives here rather than in the viewer — the viewer is mounted
 * per file, and that is exactly what has to survive clicking through the tree
 * and back.
 */
export function DiffWorkspace({ slug }: { slug: DiffSlug }) {
	const adapter = requireAdapter(slug.registry);
	const navigate = useNavigate();
	const session = useDiffSession(slug);
	const files = flattenFiles(session.tree);
	const viewer = useDiffView(session.key, session.file?.path ?? "");
	// Opening a file is a URL write like any other navigation; the session
	// follows the address, never the click.
	function openFile(file: string) {
		navigate({ to: buildPath(adapter, { ...slug, file }) });
	}

	/** Closing a file is the same write with nothing in the file segment. */
	function closeFile() {
		navigate({ to: buildPath(adapter, { ...slug, file: "" }) });
	}

	return (
		// The parsed URL, stated on the shell: it is what the route hands down,
		// server-rendered, and the routing suite reads it here rather than from
		// controls whose values also depend on what a registry answered.
		<div
			className={styles.workspace}
			data-testid="workspace"
			data-package={slug.package}
			data-from={slug.from}
			data-to={slug.to}
			data-file={slug.file}
		>
			<WorkspaceHeader slug={slug} />
			<main className={styles.body}>
				<p
					className={styles.status}
					data-testid="diff-status"
					data-state={session.status}
				>
					{session.status === "idle" && "Choose a package and two versions."}
					{session.status === "loading" && (
						<Spinner label={`Comparing ${slug.package}…`} />
					)}
					{session.status === "ready" &&
						`${files.length} ${files.length === 1 ? "file" : "files"}`}
				</p>

				{session.status === "error" && (
					<p className={styles.error} role="alert" data-testid="diff-error">
						{session.error}
					</p>
				)}

				{session.status === "ready" && (
					<div className={styles.panels}>
						<TreePanel
							tree={session.tree}
							selectedPath={slug.file}
							onOpenFile={openFile}
						/>
						{session.file && (
							<section className={styles.file} data-testid="diff-file">
								<h2>{session.file.path}</h2>
								{session.file.status === "loading" && (
									<Spinner label={`Loading ${session.file.path}…`} />
								)}
								{session.file.status === "error" && (
									<p role="alert" data-testid="file-error">
										{session.file.error}
									</p>
								)}
								{session.file.diff && (
									// Keyed by path: a new file is a new view, which is what
									// makes restoring its scroll a plain mount effect.
									<DiffView
										file={session.file.diff}
										key={session.file.path}
										onClose={closeFile}
										onReveal={viewer.reveal}
										onScrolled={viewer.rememberScroll}
										path={session.file.path}
										split={viewer.split}
										view={viewer.view}
									/>
								)}
							</section>
						)}
					</div>
				)}
			</main>
		</div>
	);
}
