import type { IconProps } from "../../utils/types.ts";

export default function FilterIcon(props: IconProps) {
	return (
		<svg
			className={props.className}
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<title>Filter</title>
			<path d="M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
		</svg>
	);
}
