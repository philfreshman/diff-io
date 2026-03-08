import type { IconProps } from "../../utils/types.ts";

export default function SystemIcon({ className, ...props }: IconProps) {
	return (
		<svg
			className={className}
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
			<path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11ZM7 21h10M12 18v3" />
		</svg>
	);
}
