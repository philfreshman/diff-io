import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
	const url = new URL(context.request.url);
	const pathname = decodeURIComponent(url.pathname);
	const parts = pathname.split("/").filter(Boolean);

	if (parts.length >= 2) {
		const registry = parts[0];
		if (registry === "npm" || registry === "crates" || registry === "pypi") {
			// If it's a deep link like /npm/pkg/1/2, rewrite to /npm or /crates
			// but only if it's not the exact base path and not an internal request
			if (parts.length > 1 && !pathname.startsWith("/_astro")) {
				// Always rewrite to the base registry path with a trailing slash or not
				// depending on what exists in dist. In our case, dist/npm/index.html
				// so /npm or /npm/ should both work.
				return context.rewrite(`/${registry}`);
			}
		}
	}

	return next();
});
