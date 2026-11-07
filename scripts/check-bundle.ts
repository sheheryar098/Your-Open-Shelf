/**
 * Bundle budget check: fails when any route's client JavaScript exceeds
 * its brotli-compressed budget in bundle-budget.json. Run after `next build`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { brotliCompressSync, constants } from "node:zlib";

const root = path.resolve(__dirname, "..");
const next = path.join(root, ".next");
const budget = JSON.parse(readFileSync(path.join(root, "bundle-budget.json"), "utf8")) as {
  defaultKb: number;
  routes?: Record<string, number>;
};

if (!existsSync(path.join(next, "build-manifest.json"))) {
  console.error("No build found. Run `npm run build` first.");
  process.exit(1);
}

const buildManifest = JSON.parse(readFileSync(path.join(next, "build-manifest.json"), "utf8")) as {
  rootMainFiles: string[];
};
const sizeCache = new Map<string, number>();
function brotliKb(rel: string): number {
  const file = path.join(next, rel.replace(/^\/_next\//, ""));
  if (!sizeCache.has(file)) {
    const buf = readFileSync(file);
    sizeCache.set(file, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length / 1024);
  }
  return sizeCache.get(file)!;
}

function manifests(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...manifests(p));
    else if (name === "page_client-reference-manifest.js") out.push(p);
  }
  return out;
}

const rows: { route: string; kb: number; limit: number }[] = [];
for (const file of manifests(path.join(next, "server", "app"))) {
  const sandbox: {
    globalThis?: unknown;
    __RSC_MANIFEST?: Record<
      string,
      { clientModules: Record<string, { chunks: string[] }>; entryJSFiles?: Record<string, string[]> }
    >;
  } = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(file, "utf8"), sandbox);
  for (const [key, m] of Object.entries(sandbox.__RSC_MANIFEST ?? {})) {
    const route = key.replace(/\/page$/, "") || "/";
    if (route.startsWith("/_")) continue;
    const chunks = new Set<string>(buildManifest.rootMainFiles);
    for (const mod of Object.values(m.clientModules)) for (const c of mod.chunks) if (c.endsWith(".js")) chunks.add(c);
    for (const list of Object.values(m.entryJSFiles ?? {})) for (const c of list) if (c.endsWith(".js")) chunks.add(c);
    const kb = [...chunks].reduce((sum, c) => sum + brotliKb(c), 0);
    rows.push({ route, kb, limit: budget.routes?.[route] ?? budget.defaultKb });
  }
}

rows.sort((a, b) => b.kb - a.kb);
const over = rows.filter((r) => r.kb > r.limit);
console.log("Route client JS (brotli):");
for (const r of rows.slice(0, 15))
  console.log(
    `  ${r.kb.toFixed(1).padStart(7)} kB / ${r.limit} kB  ${r.route}${r.kb > r.limit ? "  ✗ OVER BUDGET" : ""}`,
  );
if (rows.length > 15) console.log(`  … ${rows.length - 15} more routes`);
if (over.length) {
  console.error(`\n${over.length} route(s) exceed their bundle budget. Analyze before raising a budget.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} routes within budget.`);
