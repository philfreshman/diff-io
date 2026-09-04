import { IGNORE_WHITESPACE_KEY } from "#/lib/diff/prefs.ts";
import { MODULE_VERSION } from "#/lib/registries/go.ts";
import { registryAdapters } from "#/lib/registries/index.ts";
import type { DiffRequest } from "./protocol.ts";

/**
 * Where the boot script leaves what it started, for `readDiffBoot` to find. A
 * name rather than a symbol because the script that writes it and the module
 * that reads it never meet in a module graph — which is also why it is stated
 * here once and reached only through the two functions below.
 */
const DIFF_BOOT_GLOBAL = "__diffpackDiffBoot";

/**
 * What the boot script leaves behind: the worker it spawned, the comparison it
 * asked for and under which id, and every reply that landed before a client
 * existed to hear it.
 */
export interface DiffBoot {
	worker: Worker;
	id: number;
	request: DiffRequest & { ignoreWhitespace: boolean };
	/** Replies buffered by the script's own handler, oldest first. */
	replies: unknown[];
}

/**
 * The boot, if the script found a comparison to start. Read lazily — the
 * module is evaluated on the server too, where there is no `window` and
 * nothing has been booted.
 */
export function readDiffBoot(): DiffBoot | null {
	const holder = globalThis as Record<string, unknown>;
	return (holder[DIFF_BOOT_GLOBAL] as DiffBoot | undefined) ?? null;
}

const REGISTRY_IDS = registryAdapters.map((adapter) => adapter.id);

/**
 * Runs in `<head>`, before anything is hydrated, so a deep link's archives are
 * already downloading by the time React has an opinion about them.
 *
 * Like `THEME_SCRIPT` it cannot import the modules it belongs to — nothing is
 * loaded yet at that point — so two things are restated inline: how far a
 * package name reaches into the path, which is each adapter's `packagePath`,
 * the reading of the stored whitespace answer, which is `parseIgnoreWhitespace`,
 * and the shape of a `build-tree` request, which is `protocol.ts`. The values
 * they turn on are interpolated from those modules so they stay single-sourced.
 *
 * The `[BENCH]` line is instrumentation only — see philfreshman/diffpack#148:
 * it is the phase this whole script exists to move, and the session's own
 * `page-load-to-build-tree` no longer measures it. Strip it with the rest.
 *
 * Restating is what makes it possible to get this wrong, and the cost of
 * getting it wrong is bounded: a request the session does not recognise as its
 * own is simply not adopted, and the session issues the right one itself.
 */
export function buildDiffBootScript(workerUrl: string): string {
	return `(()=>{try{
var REGISTRIES=${JSON.stringify(REGISTRY_IDS)};
var GO_VERSION=new RegExp(${JSON.stringify(MODULE_VERSION.source)});
var decode=function(s){try{return decodeURIComponent(s)}catch(e){return s}};
var parts=location.pathname.split("/").filter(Boolean).map(decode);
var registry=parts.shift();
if(REGISTRIES.indexOf(registry)<0)return;
var width=1;
if(registry==="npm"){if(parts[0]&&parts[0].charAt(0)==="@")width=2}
else if(registry==="go"){width=parts.length;
for(var i=0;i<parts.length;i++)if(GO_VERSION.test(parts[i])){width=i;break}}
var pkg=parts.slice(0,width).join("/"),from=parts[width],to=parts[width+1];
if(!pkg||!from||!to)return;
var ignoreWhitespace=localStorage.getItem(${JSON.stringify(IGNORE_WHITESPACE_KEY)})==="true";
var request={registry:registry,pkg:pkg,from:from,to:to,ignoreWhitespace:ignoreWhitespace};
var worker=new Worker(${JSON.stringify(workerUrl)},{type:"module"});
var boot={worker:worker,id:0,request:request,replies:[]};
worker.onmessage=function(event){boot.replies.push(event.data)};
worker.postMessage({id:boot.id,type:"build-tree",registry:registry,pkg:pkg,from:from,to:to,ignoreWhitespace:ignoreWhitespace});
console.log("[BENCH] boot-build-tree "+performance.now().toFixed(1)+"ms");
window.${DIFF_BOOT_GLOBAL}=boot;
}catch(e){}})();`;
}
