import type { IconProps } from "../../utils/types.ts";

export default function Kbd(props: IconProps) {
	return (
		<kbd className="inline-grid w-4 h-4 p-0 text-xs leading-none align-text-bottom bg-transparent border border-gray-400 rounded shadow-none place-items-center">
			{props.children}
		</kbd>
	);
}
