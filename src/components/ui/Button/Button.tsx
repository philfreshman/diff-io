import { Button as Base } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./Button.module.css";

/**
 * A labelled button. Base UI is touched from `components/ui/` only, so its API
 * has one place to change.
 *
 * `className` is for placement (width, alignment), not for restyling; the
 * caller's class is appended so it wins on equal specificity.
 */
export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
	/** `primary` is the one action a screen is asking for. */
	variant?: "primary" | "neutral";
}

export function Button({
	variant = "neutral",
	className,
	children,
	...props
}: ButtonProps) {
	return (
		<Base
			className={className ? `${styles.button} ${className}` : styles.button}
			data-variant={variant}
			{...props}
		>
			{children}
		</Base>
	);
}
