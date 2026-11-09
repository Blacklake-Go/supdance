import { mkdir, copyFile, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
  entrypoints: ["web/app.tsx", "web/widget.tsx"], target: "browser", format: "esm",
  outdir: "dist", minify: true, define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
const widget = await Bun.file("dist/widget.js").text();
await writeFile("dist/widget.html", `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supdance</title><style>
:root{color-scheme:light dark;font:14px/1.5 system-ui,sans-serif}
main{padding:12px;color:var(--color-text-primary,CanvasText)}
h2{margin:.3rem 0;font-size:1.1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto}
button,a{display:inline-flex;align-items:center;min-height:44px;padding:0 .8rem;border:1px solid currentColor;border-radius:8px;
font:inherit;color:inherit;background:transparent;cursor:pointer}
</style><div id="root"></div><script type="module">${widget.replace(/<\/script/gi, "<\\/script")}</script>`);
await Promise.all([copyFile("web/index.html", "dist/index.html"), copyFile("web/styles.css", "dist/styles.css")]);
