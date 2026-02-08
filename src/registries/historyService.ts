import type { SearchResult } from "./types.ts";

export function getHistory(registry: string): SearchResult[] {
	const HISTORY_KEY = `search_history_${registry}`;
	try {
		const history = localStorage.getItem(HISTORY_KEY);
		return history ? JSON.parse(history) : [];
	} catch {
		return [];
	}
}

export function saveToHistory(registry: string, pkg: SearchResult) {
	const HISTORY_KEY = `search_history_${registry}`;
	const history = getHistory(registry);
	const newHistory = [
		pkg,
		...history.filter((item) => item.name !== pkg.name),
	].slice(0, 10);
	localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
}
