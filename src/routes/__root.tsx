import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { NotFound } from "#/components/NotFound.tsx";
import { ThemeToggle } from "#/components/theme/ThemeToggle.tsx";
import { THEME_SCRIPT } from "#/lib/themeScript.ts";
import globalsCss from "#/styles/globals.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1.0" },
			{ title: "diffpack" },
		],
		links: [{ rel: "stylesheet", href: globalsCss }],
	}),
	notFoundComponent: NotFound,
	shellComponent: RootDocument,
});

function RootDocument() {
	return (
		// `data-theme` is deliberately absent here: the pre-paint script below owns
		// it and has already written it by the time React hydrates, which is exactly
		// the mismatch `suppressHydrationWarning` exists for.
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: pre-paint theme script must be inline */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<ThemeToggle />
				<Outlet />
				<Scripts />
			</body>
		</html>
	);
}
