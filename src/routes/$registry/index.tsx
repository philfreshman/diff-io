import { createFileRoute } from "@tanstack/react-router";
import { DiffWorkspace } from "#/components/workspace/DiffWorkspace/DiffWorkspace.tsx";
import { requireAdapter } from "#/lib/registries/index.ts";
import { metaTags } from "#/lib/url/documentMeta.ts";
import { parseSlug } from "#/lib/url/slug.ts";

export const Route = createFileRoute("/$registry/")({
	// `/npm` is the same workspace with nothing selected in it.
	loader: ({ params }) => parseSlug(requireAdapter(params.registry), ""),
	head: ({ params, loaderData }) =>
		loaderData
			? { meta: metaTags(requireAdapter(params.registry), loaderData) }
			: {},
	component: RegistryRoute,
});

function RegistryRoute() {
	return <DiffWorkspace slug={Route.useLoaderData()} />;
}
