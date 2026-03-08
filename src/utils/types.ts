import type { ReactNode, SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
	className?: string;
	children?: ReactNode;
}
