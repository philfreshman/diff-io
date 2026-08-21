import {
	DEFAULT_TREE_WIDTH,
	MAX_TREE_WIDTH,
	MIN_TREE_WIDTH,
	TREE_WIDTH_KEY,
	TREE_WIDTH_PROPERTY,
} from "./prefs.ts";

/**
 * Runs in `<head>` before the first paint, so the tree panel is already the
 * width the visitor left it at. Like `THEME_SCRIPT`, it cannot import the
 * module it belongs to — nothing is loaded yet — so the rules are restated
 * inline over values interpolated from `prefs.ts`.
 */
export const TREE_WIDTH_SCRIPT = `(()=>{try{
var w=parseInt(localStorage.getItem(${JSON.stringify(TREE_WIDTH_KEY)}),10);
if(isNaN(w))w=${DEFAULT_TREE_WIDTH};
w=Math.min(${MAX_TREE_WIDTH},Math.max(${MIN_TREE_WIDTH},w));
document.documentElement.style.setProperty(${JSON.stringify(TREE_WIDTH_PROPERTY)},w+"px");
}catch(e){}})();`;
