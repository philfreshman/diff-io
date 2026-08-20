import type { Fetcher } from "./types.ts";

async function request(
	fetcher: Fetcher,
	url: string,
	signal: AbortSignal | undefined,
	whatFailed: string,
): Promise<Response> {
	const res = await fetcher(url, { signal });
	if (!res.ok) throw new Error(`${whatFailed} (${res.status})`);
	return res;
}

export async function getJson<T>(
	fetcher: Fetcher,
	url: string,
	signal: AbortSignal | undefined,
	whatFailed: string,
): Promise<T> {
	return (await request(fetcher, url, signal, whatFailed)).json() as Promise<T>;
}

export async function getText(
	fetcher: Fetcher,
	url: string,
	signal: AbortSignal | undefined,
	whatFailed: string,
): Promise<string> {
	return (await request(fetcher, url, signal, whatFailed)).text();
}
