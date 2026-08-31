import styles from "./Spinner.module.css";

/**
 * A busy indicator for work the user is waiting on inside a control — the
 * search field's middle state. It announces itself, because the reason the
 * list is empty is not visible to a screen reader otherwise.
 */
export function Spinner({ label = "Loading" }: { label?: string }) {
	return (
		<span className={styles.spinner} role="status" aria-label={label}>
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" opacity="0.25" />
				<path d="M21 12a9 9 0 0 0-9-9" />
			</svg>
		</span>
	);
}
