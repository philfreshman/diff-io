/**
 * The measurement ID the Astro site used. It is a property that already has
 * history behind it, so the rebuild keeps reporting into the same one rather
 * than starting a new series that would read as a traffic cliff.
 */
export const GA_MEASUREMENT_ID = "G-JH9PM7WWGG";

export const GA_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;

/**
 * The bootstrap half of gtag.js, inline in `<head>` as Google specifies it: the
 * queue has to exist before the async library lands, or the events fired
 * between parse and load are lost.
 *
 * Route changes are client-side navigations, so nothing here sends a second
 * page_view — `send_page_view` on the initial config is the whole contract, the
 * same as it was in the Astro app.
 */
export const GA_SCRIPT = `window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag("js",new Date());
gtag("config",${JSON.stringify(GA_MEASUREMENT_ID)});`;
