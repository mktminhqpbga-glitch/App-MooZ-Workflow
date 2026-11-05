// Run with npm run test:browser; CHROMIUM_PATH may select a system browser.
const { chromium } = require("playwright"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
(async () => {
  let browser;
  const port = 4191,
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
  try {
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
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + port);
    await page.getByRole("button", { name: "＋ Tạo dự án" }).click();
    await page.locator("dialog[open] input").fill("Dự án kiểm chứng");
    await page.getByRole("button", { name: "Lưu dự án", exact: true }).click();
    await page.waitForURL(/#project\//);
    await page.getByRole("heading", { name: "Dự án kiểm chứng" }).waitFor();
    const id = page.url().split("#project/")[1];
    await page.reload();
    await page.getByRole("heading", { name: "Dự án kiểm chứng" }).waitFor();
    await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
    await page.locator("dialog[open] input").fill("Tên mới");
    await page.getByRole("button", { name: "Lưu dự án", exact: true }).click();
    await page.getByRole("heading", { name: "Tên mới", exact: true }).waitFor();
    const conflict = await page.evaluate(async (id) => {
      const { ProjectRepository } = await import("./core/projects.js");
      const a = new ProjectRepository(),
        b = new ProjectRepository(),
        first = await a.get(id),
        stale = await b.get(id);
      await a.save({ ...first, name: "Bản mới nhất" });
      try {
        await b.save({ ...stale, name: "Ghi đè cũ" });
        return false;
      } catch {
        return (await a.get(id)).name === "Bản mới nhất";
      }
    }, id);
    assert.equal(conflict, true);
    await page.reload();
    await page.getByRole("heading", { name: "Bản mới nhất" }).waitFor();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Xuất JSON" }).click();
    const file = await download;
    const raw = await fs.readFile(await file.path(), "utf8");
    assert.equal(JSON.parse(raw).format, "mooz-cvn-project");
    await page.getByRole("button", { name: "Nhân bản", exact: true }).click();
    await page.waitForURL((url) => url.hash !== "#project/" + id);
    await page
      .getByRole("heading", { name: "Bản mới nhất · Bản sao" })
      .waitFor();
    await page.goto("http://127.0.0.1:" + port);
    assert.equal(await page.locator(".project-card").count(), 2);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Nhập dự án", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "project.json",
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".project-card").length === 3,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (process.env.REVIEW_DIR) {
      await fs.mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "projects-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "projects-desktop.png"),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: create/reload/rename/duplicate/export/import; atomic stale-write rejection; mobile layout; no renderer errors.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
