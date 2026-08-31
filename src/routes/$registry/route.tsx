import { createFileRoute, notFound } from "@tanstack/react-router";
import { getAdapter } from "#/lib/registries/index.ts";
import type { RegistryId } from "#/lib/registries/types.ts";

export const Route = createFileRoute("/$registry")({
	params: {
		// Narrows `params.registry` for every descendant and for `<Link/>`. The cast
		// holds because `beforeLoad` below turns anything else into a 404 before a
		// loader or component ever reads the param.
		parse: ({ registry }) => ({ registry: registry as RegistryId }),
		stringify: ({ registry }) => ({ registry }),
	},
	beforeLoad: ({ params }) => {
		// The first segment is user input. The old app quietly read `/maven/guava`
		// as the npm package "guava", which made a typo look like a real page;
		// an unknown registry is a 404 (decision 11.6).
		//
		// The adapter itself is deliberately *not* returned as route context:
		// route context is serialised into the SSR payload, and an adapter carries
		// methods. Child routes look it up from the param instead.
		if (!getAdapter(params.registry)) throw notFound();
	},
});
