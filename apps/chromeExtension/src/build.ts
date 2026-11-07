import { cp, mkdir, rm, readFile, readdir, writeAtomic } from "@toonflow/file";
import { resolve, join } from "node:path";
import { zipSync } from "fflate";

const root = resolve(import.meta.dirname, ".."), output = resolve(root, "../../build/chromeExtension");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ["manifest.json", "popup.html", "popup.css", "bridge"]) await cp(resolve(root, name), resolve(output, name), { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(root, "src/background.ts"), resolve(root, "src/popup.ts")], outdir: output, target: "browser", format: "iife" });
if (!result.success) throw new AggregateError(result.logs, "Chrome extension build failed");
const files: Record<string, Uint8Array> = {};
async function collect(directory: string, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), key = prefix + entry.name;
    if (entry.isDirectory()) await collect(path, key + "/");
    else if (entry.isFile()) files[key] = await readFile(path);
  }
}
await collect(output);
await writeAtomic(resolve(output, "../toonflowChromeConnect.zip"), zipSync(files));
console.log(`Chrome extension: ${output}`);
