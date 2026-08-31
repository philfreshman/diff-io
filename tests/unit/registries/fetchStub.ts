/** Records what an adapter asked for, and answers with canned responses. */
export function stubFetch(
	handler: (url: string) => Response | Promise<Response>,
) {
	const calls: { url: string; signal?: AbortSignal | null }[] = [];

	const fetcher = async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input);
		calls.push({ url, signal: init?.signal });
		return handler(url);
	};

	return { fetcher, calls };
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export function text(body: string, status = 200): Response {
	return new Response(body, { status });
}
