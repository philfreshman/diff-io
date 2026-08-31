import { DEFAULT_SELECTION, themeColor } from "./theme.ts";

/**
 * Runs in `<head>` before the first paint, so the page never renders in one
 * theme and then flips to another. It cannot import `theme.ts` — nothing is
 * loaded yet at that point — so the branching is restated inline; the values it
 * branches on are interpolated from the module so they stay single-sourced.
 */
export const THEME_SCRIPT = `(()=>{try{
var s=localStorage.getItem("theme");
if(s!=="light"&&s!=="dark"&&s!=="system")s=${JSON.stringify(DEFAULT_SELECTION)};
var t=s==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):s;
document.documentElement.setAttribute("data-theme",t);
document.documentElement.setAttribute("data-theme-selection",s);
var m=document.createElement("meta");
m.setAttribute("name","theme-color");
m.setAttribute("content",t==="light"?${JSON.stringify(themeColor("light"))}:${JSON.stringify(themeColor("dark"))});
document.head.appendChild(m);
}catch(e){}})();`;
