import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const file of [
  "index.html",
  "style.css",
  "app.js",
  "projects-ui.js",
  "core/graph.js",
  "core/projects.js",
  "studio.js",
  "video-prompt.js",
  "modules.js",
  "client-api.js",
  "core/storage.js",
  "core/runner.js",
  "core/backup.js",
  "core/capabilities.js",
  "core/references.js",
  "media-tools.js",
  "image-workbench.js",
  "icons.js",
  "vendor/mooz/canvas-image-editor.js",
  "vendor/mooz/canvas-image-editor.css",
]) {
  await mkdir("dist/" + file.split("/").slice(0, -1).join("/"), {
    recursive: true,
  });
  await copyFile(file, "dist/" + file);
}
console.log("Built dist/");
