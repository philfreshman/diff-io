import type { SVGProps } from "react";

/**
 * Line icons on a 24×24 grid, stroked with `currentColor` so they inherit the
 * theme. Decorative by default — the accessible name belongs to the control.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{children}
		</svg>
	);
}

export function SunIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
		</Icon>
	);
}

export function MoonIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
		</Icon>
	);
}

export function SystemIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11ZM7 21h10M12 18v3" />
		</Icon>
	);
}
