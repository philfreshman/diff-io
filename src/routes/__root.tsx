import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
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
	shellComponent: RootDocument,
});

function RootDocument() {
	return (
		<html lang="en" data-theme="dark">
			<head>
				<HeadContent />
			</head>
			<body className="text-neutral-900 dark:text-neutral-100">
				<Outlet />
				<Scripts />
			</body>
		</html>
	);
}
