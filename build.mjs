import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("dist", { recursive: true });
const files = [
  "index.html",
  "style.css",
  "app.js",
  "projects-ui.js",
  "core/graph.js",
  "core/projects.js",
  "studio.js",
  "video-prompt.js",
  "canvas-menu.js",
  "canvas-navigation.js",
  "canvas-libraries.js",
  "assistant-ui.js",
  "modules.js",
  "client-api.js",
  "core/storage.js",
  "core/runner.js",
  "core/backup.js",
  "core/capabilities.js",
  "core/references.js",
  "core/assistant-tab.js",
  "media-tools.js",
  "image-workbench.js",
  "icons.js",
  "post-workbench.js",
  "downloads/MooZ-Connect.zip",
  "downloads/release.json",
  "core/queue-plan.js",
  "core/output-state.js",
  "core/flow-plan.js",
  "core/queue-storage.js",
  "core/queue-runner.js",
  "core/local-media.js",
  "vendor/mooz/workflow-runtime.js",
  "vendor/mooz/media-studio.js",
  "vendor/mooz/ffmpeg/ffmpeg.js",
  "vendor/mooz/ffmpeg/814.ffmpeg.js",
  "vendor/mooz/ffmpeg/ffmpeg-core.js",
  "vendor/mooz/ffmpeg/ffmpeg-core.wasm",
  "vendor/mooz/fonts/DejaVuSans.ttf",
  "vendor/mooz/fonts/LICENSE-DejaVu.txt",

  "vendor/mooz/canvas-image-editor.js",
  "vendor/mooz/canvas-image-editor.css",
];
for (const file of files) {
  await mkdir("dist/" + file.split("/").slice(0, -1).join("/"), {
    recursive: true,
  });
  await copyFile(file, "dist/" + file);
}
// Version the whole module graph together so old open pages cannot mix JS/CSS releases.
const hash = createHash("sha256");
for (const file of files) hash.update(file).update(await readFile(file));
const version = hash.digest("hex").slice(0, 12);
for (const file of files.filter(file => file.endsWith(".js"))) {
  const source = await readFile("dist/" + file, "utf8");
  await writeFile("dist/" + file, source.replace(/(["'])(\.{1,2}\/[^"'\s?]+\.js)\1/g, (_, quote, path) => `${quote}${path}?v=${version}${quote}`));
}
const html = await readFile("dist/index.html", "utf8");
await writeFile("dist/index.html", html.replace(/((?:src|href)=")([^"?]+\.(?:js|css))"/g, (_, prefix, path) => `${prefix}${path}?v=${version}"`));
console.log("Built dist/");
