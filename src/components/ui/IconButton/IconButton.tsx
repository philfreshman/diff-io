import { Button } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./IconButton.module.css";

/**
 * A square, transparent button holding a single icon. Base UI is touched from
 * `components/ui/` only, so its API has one place to change.
 * An accessible name is required — the icon alone is not one.
 *
 * `className` is for placement (position, margin), not for restyling the
 * button; the caller's class is appended so it wins on equal specificity.
 */
export interface IconButtonProps extends ComponentPropsWithoutRef<"button"> {
	"aria-label": string;
}

export function IconButton({ children, className, ...props }: IconButtonProps) {
	return (
		<Button
			className={
				className ? `${styles.iconButton} ${className}` : styles.iconButton
			}
			{...props}
		>
			{children}
		</Button>
	);
}
