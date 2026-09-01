import { useNavigate } from "@tanstack/react-router";
import type { Ref } from "react";
import { useMemo, useRef, useState } from "react";
import { DiffToolbar } from "#/components/diff/DiffToolbar/DiffToolbar.tsx";
import type { DiffViewHandle } from "#/components/diff/DiffView/DiffView.tsx";
import { DiffView } from "#/components/diff/DiffView/DiffView.tsx";
import type { DiffViewControls } from "#/components/diff/useDiffView.ts";
import { useDiffView } from "#/components/diff/useDiffView.ts";
import { useIgnoreWhitespace } from "#/components/diff/useIgnoreWhitespace.ts";
import { TreePanel } from "#/components/tree/TreePanel/TreePanel.tsx";
import { Spinner } from "#/components/ui/Spinner/Spinner.tsx";
import { countDifferences } from "#/lib/diff/changes.ts";
import { parseUnifiedDiff } from "#/lib/diff/parseUnifiedDiff.ts";
import { requireAdapter } from "#/lib/registries/index.ts";
import type { DiffSessionState, OpenFile } from "#/lib/session/diffSession.ts";
import { type ShownFile, shownFile } from "#/lib/session/shownFile.ts";
import { changedFiles, flattenFiles } from "#/lib/session/tree.ts";
import { buildPath, type DiffSlug } from "#/lib/url/slug.ts";
import { useDiffSession } from "../useDiffSession.ts";
import { WorkspaceHeader } from "../WorkspaceHeader/WorkspaceHeader.tsx";
import styles from "./DiffWorkspace.module.css";

/**
 * The workspace shell: the header assembles a comparison, the body shows the
 * one the URL already names.
 *
 * The tree and the toolbar are the body's frame, not the comparison's — they
 * stand from the first paint, empty and stood down, so that choosing a package
 * fills a layout the reader is already looking at rather than replacing one.
 *
 * Opening a file is a URL write like any other navigation, and how much of a
 * file is open lives here rather than in the viewer — the viewer is mounted
 * per file, and that is exactly what has to survive clicking through the tree
 * and back.
 *
 * What each of the two panels shows while the comparison is still arriving is
 * that panel's own business, and is answered below rather than here: this
 * function assembles the frame and leaves the states to `TreeStatus` and
 * `FilePane`.
 */
export function DiffWorkspace({ slug }: { slug: DiffSlug }) {
	const adapter = requireAdapter(slug.registry);
	const navigate = useNavigate();
	const whitespace = useIgnoreWhitespace();
	const session = useDiffSession(slug, whitespace.ignore);
	const files = flattenFiles(session.tree);
	// The files the toolbar's arrows walk: the unchanged ones are what the tree
	// hides by default, and stepping into one would look like a broken button.
	const changed = changedFiles(session.tree);
	const fileIndex = changed.findIndex((entry) => entry.path === slug.file);

	// The file on screen, which is not always the file last asked for — see
	// `shownFile`. It is state adjusted during render rather than in an effect,
	// which would show the empty pane for a frame first.
	const [shown, setShown] = useState<ShownFile | null>(null);
	const next = shownFile(shown, session.file);
	if (next?.diff !== shown?.diff) setShown(next);

	const viewer = useDiffView(session.key, shown?.path ?? "");
	// Parsed here as well as in the viewer so the count stands whatever the file
	// is doing: folding and split view move differences between rows, but they
	// do not change how many the file has. It counts what is on screen, so it
	// changes when the blur clears rather than a moment before it.
	const differences = useMemo(
		() => (shown ? countDifferences(parseUnifiedDiff(shown.diff)) : 0),
		[shown],
	);
	const view = useRef<DiffViewHandle>(null);

	// Opening a file is a URL write like any other navigation; the session
	// follows the address, never the click.
	function openFile(file: string) {
		navigate({ to: buildPath(adapter, { ...slug, file }) });
	}

	/** Closing a file is the same write with nothing in the file segment. */
	function closeFile() {
		navigate({ to: buildPath(adapter, { ...slug, file: "" }) });
	}

	/** The file before or after this one, in the order the tree lists them. */
	function stepFile(direction: 1 | -1) {
		const next = changed[fileIndex + direction];
		if (next) openFile(next.path);
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
				{session.status === "error" && (
					<p className={styles.error} role="alert" data-testid="diff-error">
						{session.error}
					</p>
				)}

				<div className={styles.panels}>
					<TreePanel
						tree={session.tree}
						selectedPath={slug.file}
						onOpenFile={openFile}
						footer={
							<TreeStatus
								changedCount={changed.length}
								fileCount={files.length}
								packageName={slug.package}
								status={session.status}
							/>
						}
					/>
					<section className={styles.file} data-testid="diff-file">
						<DiffToolbar
							path={session.file?.path ?? ""}
							fileIndex={fileIndex}
							fileCount={changed.length}
							onStepFile={stepFile}
							onClose={closeFile}
							differences={differences}
							onStepDifference={(direction) =>
								view.current?.stepDifference(direction)
							}
							expandAll={viewer.view.expandAll}
							onExpandAllChange={viewer.setExpandAll}
							split={viewer.split}
							onSplitChange={viewer.setSplit}
							ignoreWhitespace={whitespace.ignore === true}
							onIgnoreWhitespaceChange={whitespace.set}
						/>
						<FilePane
							file={session.file}
							onClose={closeFile}
							ref={view}
							sessionStatus={session.status}
							shown={shown}
							viewer={viewer}
						/>
					</section>
				</div>
			</main>
		</div>
	);
}

interface TreeStatusProps {
	status: DiffSessionState["status"];
	packageName: string;
	fileCount: number;
	changedCount: number;
}

/**
 * What state the comparison is in, said under the tree it describes. Empty
 * while there is nothing to say — the element stays, because what state the
 * comparison is in is read off it.
 */
function TreeStatus({
	status,
	packageName,
	fileCount,
	changedCount,
}: TreeStatusProps) {
	return (
		<p className={styles.status} data-testid="diff-status" data-state={status}>
			{status === "loading" && <Spinner label={`Comparing ${packageName}…`} />}
			{status === "ready" &&
				`${fileCount} ${fileCount === 1 ? "file" : "files"}, ${changedCount} changed`}
		</p>
	);
}

interface FilePaneProps {
	/** Where the comparison as a whole has got to. */
	sessionStatus: DiffSessionState["status"];
	/** The file the URL names, or `null` when it names none. */
	file: OpenFile | null;
	/** The file actually on screen, which the blur keeps a step behind. */
	shown: ShownFile | null;
	viewer: DiffViewControls;
	onClose(): void;
	/** How the toolbar's difference arrows reach the viewer's scroller. */
	ref: Ref<DiffViewHandle>;
}

/**
 * Under the toolbar: nothing asked for yet, a file on its way, a file that
 * failed, or the file itself.
 */
function FilePane({
	sessionStatus,
	file,
	shown,
	viewer,
	onClose,
	ref,
}: FilePaneProps) {
	return (
		<>
			{sessionStatus === "idle" && (
				<p className={styles.empty}>Choose a package and two versions.</p>
			)}
			{/* Only with nothing to blur: the first file of a comparison has no
			    predecessor to keep on screen. */}
			{file?.status === "loading" && !shown && (
				<Spinner label={`Loading ${file.path}…`} />
			)}
			{file?.status === "error" && (
				<p role="alert" data-testid="file-error">
					{file.error}
				</p>
			)}
			{shown && (
				// Keyed by path: a new file is a new view, which is what makes
				// restoring its scroll a plain mount effect.
				<DiffView
					file={shown.diff}
					key={shown.path}
					onClose={onClose}
					onReveal={viewer.reveal}
					onScrolled={viewer.rememberScroll}
					path={shown.path}
					pending={file?.status === "loading"}
					ref={ref}
					split={viewer.split}
					view={viewer.view}
				/>
			)}
		</>
	);
}
