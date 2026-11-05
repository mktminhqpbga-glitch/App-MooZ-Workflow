const { chromium } = require("playwright"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs/promises");
(async () => {
  const port = 4192,
    url = "http://127.0.0.1:" + port,
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1500, height: 960 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, 640, 360);
      g.addColorStop(0, "#254741");
      g.addColorStop(1, "#b5c9b0");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "#172923";
      ctx.font = "40px sans-serif";
      ctx.fillText("MooZ CVN", 48, 190);
      return c.toDataURL("image/png");
    });
    await page.route("**/api/jobs", async (route) => {
      const req = route.request().postDataJSON();
      await route.fulfill({
        json: {
          id: req.requestId,
          status: "success",
          result:
            req.mediaType === "text"
              ? { kind: "text", text: "Kết quả kiểm chứng" }
              : { kind: "image", url: image },
        },
      });
    });
    await page.getByRole("button", { name: "＋ Tạo dự án" }).click();
    await page.locator("dialog[open] input").fill("Studio kiểm chứng");
    await page.getByRole("button", { name: "Lưu dự án", exact: true }).click();
    await page.waitForURL(/#project\//);
    await page.getByRole("button", { name: "Mở Canvas" }).click();
    await page.waitForURL(/#canvas\//);
    await page.locator(".cvn-studio").waitFor();
    await page
      .getByRole("button", { name: "Thêm prompt", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Nội dung yêu cầu" })
      .fill("Đầu vào có kết nối");
    await page
      .locator(".cvn-composer")
      .getByRole("button", { name: "×", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Tạo văn bản", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Nội dung yêu cầu" })
      .fill("Giữ nguyên dữ liệu");
    await page
      .getByLabel("AI thực hiện", { exact: true })
      .selectOption("openai");
    await page
      .getByLabel("Nguồn nối", { exact: true })
      .selectOption({ index: 0 });
    await page.getByRole("button", { name: "Nối nguồn", exact: true }).click();
    await page
      .getByRole("button", { name: "Tạo kết quả ↑", exact: true })
      .click();
    await page.getByText("Kết quả kiểm chứng", { exact: true }).waitFor();
    await page
      .locator(".cvn-composer")
      .getByRole("button", { name: "×", exact: true })
      .click();
    await page
      .locator(".cvn-studio input[type=file]")
      .setInputFiles({
        name: "Nguon.png",
        mimeType: "image/png",
        buffer: Buffer.from(image.split(",")[1], "base64"),
      });
    await page.locator(".cvn-node img").waitFor();
    await page.getByRole("button", { name: "Vừa khung", exact: true }).click();
    if (process.env.REVIEW_DIR) {
      await fs.mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "libtv-studio.png"),
      });
    }
    await page.reload();
    await page.locator(".cvn-node img").waitFor();
    await page.getByText("Kết quả kiểm chứng", { exact: true }).waitFor();
    assert.equal(await page.locator(".cvn-wires path").count(), 1);
    await page.goto(url + "/#library");
    await page.getByRole("button", { name: "Đầu vào", exact: true }).click();
    await page.locator(".library-card").waitFor();
    await page.getByRole("button", { name: "Xóa", exact: true }).click();
    await page.getByText(/Đang dùng trong:/).waitFor();
    assert.equal(await page.locator(".library-card").count(), 1);
    await page.getByRole("button", { name: "Kết quả", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".library-card").length === 0,
    );
    await page.getByRole("button", { name: "Prompt", exact: true }).click();
    await page
      .getByRole("button", { name: "＋ Lưu prompt", exact: true })
      .click();
    await page.getByLabel("Tên prompt", { exact: true }).fill("Prompt cá nhân");
    await page
      .getByLabel("Nội dung prompt", { exact: true })
      .fill("Nội dung lưu riêng");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await page.getByText("Prompt cá nhân", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Xóa", exact: true }).click();
    await page.getByText("Chưa có mục nào trong Prompt.").waitFor();
    await page.goto(url + "/#images");
    await page
      .getByLabel("AI hàng loạt", { exact: true })
      .selectOption("openai");
    await page
      .getByLabel("Prompt hàng loạt", { exact: true })
      .fill("Ảnh thứ nhất\nẢnh thứ hai");
    await page.getByRole("button", { name: "Xếp tác vụ vào hàng đợi" }).click();
    for (let i = 0; i < 100; i++) {
      const count = await page.evaluate(async () => {
        const { list } = await import("./core/storage.js");
        return (await list("jobs")).filter(
          (j) => j.kind === "image" && j.status === "success",
        ).length;
      });
      if (count === 2) break;
      await page.waitForTimeout(100);
    }
    const jobs = await page.evaluate(async () => {
      const { list } = await import("./core/storage.js");
      return (await list("jobs")).map((j) => ({
        kind: j.kind,
        status: j.status,
        title: j.title,
        requests: j.requests,
        error: j.error,
      }));
    });
    assert.equal(
      jobs.filter((j) => j.kind === "image" && j.status === "success").length,
      2,
    );
    assert.notEqual(
      jobs.find((j) => j.title === "Ảnh thứ nhất").requests[
        Object.keys(jobs.find((j) => j.title === "Ảnh thứ nhất").requests)[0]
      ],
      jobs.find((j) => j.title === "Ảnh thứ hai").requests[
        Object.keys(jobs.find((j) => j.title === "Ảnh thứ hai").requests)[0]
      ],
    );
    await page.goto(url + "/#library");
    await page.getByRole("button", { name: "Kết quả", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".library-card").length === 2,
    );
    if (process.env.REVIEW_DIR)
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "separate-library.png"),
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Xóa", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".library-card").length === 1,
    );
    await page.getByRole("button", { name: "Đầu vào", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".library-card").length === 1,
    );
    await page.goto(url + "/#settings");
    await page
      .getByRole("button", { name: "Kiểm tra kết nối", exact: true })
      .click();
    await page.getByText(/Chrome chưa ghép/).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS workspace: connected graph → fixture result → persisted reload; real media input; separate stores; referenced deletion guard; prompt CRUD; two batch jobs and distinct request IDs; result deletion; honest connection status. No live AI.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
