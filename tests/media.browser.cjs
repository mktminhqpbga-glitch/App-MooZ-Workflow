const { chromium } = require("playwright"),
  { spawn, execFileSync } = require("node:child_process"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mooz-media-")),
    fixture = path.join(dir, "clip.mp4");
  let browser;
  const port = 4193,
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
  try {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x32:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      fixture,
    ]);
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch("http://127.0.0.1:" + port)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + port + "/#library");
    const data = await page.evaluate(async () => {
      const { addAsset } = await import("./core/storage.js");
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 32;
      const x = c.getContext("2d");
      x.fillStyle = "red";
      x.fillRect(0, 0, 32, 32);
      x.fillStyle = "blue";
      x.fillRect(32, 0, 32, 32);
      const b = await new Promise((r) => c.toBlob(r));
      const asset = await addAsset(
        new File([b], "Nguồn.png", { type: "image/png" }),
      );
      return { id: asset.id, url: c.toDataURL() };
    });
    await page.reload();
    await page.getByRole("button", { name: "Chỉnh ảnh", exact: true }).click();
    await page.locator("#canvasImageEditor[open]").waitFor();
    await page.click("#imageEditorFlipX");
    await page.click("#imageEditorApply");
    await page.waitForFunction(
      () => !document.querySelector("#canvasImageEditor").open,
    );
    const result = await page.evaluate(async (id) => {
      const { list, readAsset } = await import("./core/storage.js");
      const values = await list("results");
      const out = values[0],
        original = await readAsset(id);
      const bitmap = await createImageBitmap(out.blob),
        c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const x = c.getContext("2d");
      x.drawImage(bitmap, 0, 0);
      return {
        count: values.length,
        pixel: [...x.getImageData(0, 0, 1, 1).data],
        originalSize: original.blob.size,
        size: out.size,
      };
    }, data.id);
    assert.equal(result.count, 1);
    assert.deepEqual(result.pixel, [0, 0, 255, 255]);
    assert.ok(result.originalSize > 0);
    const backup = await page.evaluate(async (id) => {
      const { createProject } = await import("./core/projects.js"),
        { exportBundle, importBundle } = await import("./core/backup.js"),
        { remove } = await import("./core/storage.js");
      const p = createProject("Sao lưu thật");
      p.graph.nodes.push({
        id: "source",
        type: "imageInput",
        x: 0,
        y: 0,
        data: { assetId: id },
      });
      const bundle = await exportBundle(p),
        restored = await importBundle(bundle);
      const result = {
        original: p.id,
        restored: restored.project.id,
        assetId: restored.project.graph.nodes[0].data.assetId,
        originalAsset: id,
        embedded: JSON.parse(bundle).assets.length,
      };
      for (const a of restored.created)
        await remove(a.source === "upload" ? "inputs" : "results", a.id);
      return result;
    }, data.id);
    assert.notEqual(backup.original, backup.restored);
    assert.notEqual(backup.assetId, backup.originalAsset);
    assert.equal(backup.embedded, 1);
    const file = await fs.readFile(fixture);
    const frame = await page.evaluate(
      async (bytes) => {
        const { addAsset, list } = await import("./core/storage.js"),
          { captureFrame } = await import("./media-tools.js");
        const asset = await addAsset(
          new File([Uint8Array.from(bytes)], "Clip.mp4", { type: "video/mp4" }),
        );
        const output = await captureFrame(asset, 0);
        const image = await createImageBitmap(output.blob);
        return {
          width: image.width,
          height: image.height,
          kind: output.kind,
          source: output.source,
        };
      },
      [...file],
    );
    assert.deepEqual(frame, {
      width: 64,
      height: 32,
      kind: "image",
      source: "video-frame",
    });
    console.log(
      "PASS media: local mirror changes pixels; original retained; output in Results; full-media backup restores fresh IDs; actual MP4 frame extraction creates PNG.",
    );
  } finally {
    await browser?.close();
    server.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
