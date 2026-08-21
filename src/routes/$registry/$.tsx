import { createFileRoute } from "@tanstack/react-router";
import { DiffWorkspace } from "#/components/workspace/DiffWorkspace/DiffWorkspace.tsx";
import { requireAdapter } from "#/lib/registries/index.ts";
import { metaTags } from "#/lib/url/documentMeta.ts";
import { parseSlug } from "#/lib/url/slug.ts";

export const Route = createFileRoute("/$registry/$")({
	// One catch-all replaces the middleware and the four `vercel.json` rewrites:
	// the segments are read here, on the server, not off `location.pathname` in a
	// component after the page has already booted.
	loader: ({ params }) =>
		parseSlug(requireAdapter(params.registry), params._splat ?? ""),
	head: ({ params, loaderData }) =>
		loaderData
			? { meta: metaTags(requireAdapter(params.registry), loaderData) }
			: {},
	component: DiffRoute,
});

function DiffRoute() {
	return <DiffWorkspace slug={Route.useLoaderData()} />;
}
