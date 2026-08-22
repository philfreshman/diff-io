import type { VirtualRowProps } from "#/components/diff/virtualRow.ts";
import { highlightLine } from "#/lib/diff/highlight.ts";
import type { SplitSide } from "#/lib/diff/pairSplitRows.ts";
import styles from "./SplitDiffRow.module.css";

/**
 * The same line in both files, side by side. A removal and the addition that
 * replaced it are one change, so they arrive here already set opposite each
 * other (`pairSplitRows`); a side with nothing on it is a line the other file
 * does not have.
 */
export function SplitDiffRow({
	left,
	right,
	language,
	index,
	style,
	ref,
}: VirtualRowProps & {
	left: SplitSide;
	right: SplitSide;
	language: string | null;
}) {
	return (
		<tr
			className={styles.row}
			data-index={index}
			data-left-type={left?.line.type ?? "none"}
			data-right-type={right?.line.type ?? "none"}
			ref={ref}
			style={style}
		>
			<Half cell={left} language={language} side="left" />
			<Half cell={right} language={language} side="right" />
		</tr>
	);
}

function Half({
	cell,
	language,
	side,
}: {
	cell: SplitSide;
	language: string | null;
	side: "left" | "right";
}) {
	const line = cell?.line;
	const number = side === "left" ? line?.oldNumber : line?.newNumber;

	return (
		<td
			className={styles.half}
			data-side={side}
			data-type={line?.type ?? "none"}
		>
			<span className={styles.gutter}>{number}</span>
			<span
				className={styles.content}
				data-testid={`${side}-content`}
				// Escaped by the highlighter either way; see `DiffRow`.
				// biome-ignore lint/security/noDangerouslySetInnerHtml: the highlighter's output is markup by definition
				dangerouslySetInnerHTML={{
					__html: line ? highlightLine(line.content, language) || " " : "",
				}}
			/>
		</td>
	);
}
