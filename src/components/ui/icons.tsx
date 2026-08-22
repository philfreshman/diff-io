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

export function ArrowRightIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M9 5l7 7-7 7" />
		</Icon>
	);
}

export function GithubIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
			<path d="M9 18c-4.51 2-5-2-7-2" />
		</Icon>
	);
}

export function SearchIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-5.2-5.2" />
		</Icon>
	);
}

export function CloseIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M18 6 6 18M6 6l12 12" />
		</Icon>
	);
}

export function DownloadIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
		</Icon>
	);
}

export function FilterIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3 5h18M6 12h12M10 19h4" />
		</Icon>
	);
}

export function ChevronRightIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m9 18 6-6-6-6" />
		</Icon>
	);
}

export function ChevronDownIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 9 6 6 6-6" />
		</Icon>
	);
}

export function FolderIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
		</Icon>
	);
}

export function FolderOpenIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
		</Icon>
	);
}

export function FileIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
			<path d="M14 2v6h6" />
		</Icon>
	);
}

export function FoldDownIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 4v9M8 9l4 4 4-4M4 19h2M11 19h2M18 19h2" />
		</Icon>
	);
}

export function FoldUpIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 20v-9M8 15l4-4 4 4M4 5h2M11 5h2M18 5h2" />
		</Icon>
	);
}

export function UnfoldIcon(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 3v5M9 6l3-3 3 3M12 21v-5M9 18l3 3 3-3M4 12h2M11 12h2M18 12h2" />
		</Icon>
	);
}
