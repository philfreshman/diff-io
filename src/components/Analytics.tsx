import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { GA_MEASUREMENT_ID } from "#/lib/analytics.ts";

declare global {
	interface Window {
		gtag?: (...args: unknown[]) => void;
		dataLayer?: IArguments[];
	}
}

/** How long a route is given to write its title before the view is reported. */
const TITLE_GRACE_MS = 300;

/**
 * The Astro site was a document per URL, so gtag.js counted every comparison on
 * its own. Here a comparison is a client-side navigation and the inline
 * `config` fires exactly once, which would collapse the whole site into one
 * page_view. This sends the rest.
 *
 * The first resolved location is the one `config` already reported, so it is
 * skipped rather than counted twice.
 */
export function Analytics() {
	const href = useRouterState({
		select: (state) => state.location.href,
	});
	const reported = useRef<string | null>(null);

	useEffect(() => {
		if (reported.current === null) {
			reported.current = href;
			return;
		}
		if (reported.current === href) return;
		reported.current = href;

		// The route's `<title>` is not written in this commit, or in the frame
		// after it — the head is reconciled a moment later, on no schedule worth
		// racing. Sending straight away would file every view under the title of
		// the page the visitor just left, so this waits for the head to change
		// and gives up after a beat, which is the case where the new route's
		// title is the same as the old one's.
		const before = document.title;
		let sent = false;
		const send = () => {
			if (sent) return;
			sent = true;
			observer.disconnect();
			clearTimeout(deadline);
			window.gtag?.("event", "page_view", {
				page_location: window.location.href,
				page_path: href,
				page_title: document.title,
				send_to: GA_MEASUREMENT_ID,
			});
		};

		// The head is touched for other reasons mid-transition — a stylesheet
		// link, the theme meta — so a mutation is only the signal when the title
		// it carries is a new one.
		const observer = new MutationObserver(() => {
			if (document.title !== before) send();
		});
		observer.observe(document.head, {
			characterData: true,
			childList: true,
			subtree: true,
		});
		const deadline = setTimeout(send, TITLE_GRACE_MS);

		return () => {
			observer.disconnect();
			clearTimeout(deadline);
		};
	}, [href]);

	return null;
}
