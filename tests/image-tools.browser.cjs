const { chromium } = require("playwright"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
(async () => {
  const port = 4195,
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
        viewport: { width: 1778, height: 1100 },
      }),
      errors = [],
      sent = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route('**/api/status',route=>route.fulfill({json:{providers:[{id:'openai',ready:true,types:['text','image']}],chrome:{connected:true}}}));
    await page.goto(url);
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 64;
      const x = c.getContext("2d");
      x.fillStyle = "#386352";
      x.fillRect(0, 0, 64, 64);
      x.fillStyle = "#b9ccb9";
      x.fillRect(64, 0, 64, 64);
      return c.toDataURL();
    });
    await page.route("**/api/jobs", async (r) => {
      const input = r.request().postDataJSON();
      sent.push(input);
      await r.fulfill({
        json: {
          id: input.requestId,
          status: "success",
          result: { kind: "image", url: image },
        },
      });
    });
    const id = await page.evaluate(async () => {
      const { ProjectRepository, createProject } = await import(
        "./core/projects.js"
      );
      return (
        await new ProjectRepository().save(createProject("Studio hình ảnh"), {
          create: true,
        })
      ).id;
    });
    await page.goto(url + "/#canvas/" + id);
    await page.getByLabel("Thêm vào canvas", { exact: true }).click();
    await page.getByRole("button", { name: "Ảnh", exact: true }).click();
    const node = page.locator(".generation-node").first();
    await node
      .getByLabel("Nội dung yêu cầu", { exact: true })
      .fill("Chân dung ánh sáng studio");
    await node
      .getByLabel("AI thực hiện", { exact: true })
      .selectOption("openai");
    await node.locator(".inline-settings summary").click();
    await node.getByRole('group',{name:'Chất lượng',exact:true}).getByRole('button',{name:'Cao',exact:true}).click();
    await node.getByRole('group',{name:'Số lượng ảnh',exact:true}).getByRole('button',{name:'2 ảnh',exact:true}).click();
    await node.locator(".inline-settings summary").click();
    await node.getByRole("button", { name: "Phong cách", exact: true }).click();
    await page.getByRole("button", { name: "Điện ảnh", exact: true }).click();
    await node.getByLabel("Ống kính và máy ảnh",{exact:true}).click();
    await page.getByLabel("Tiêu cự", { exact: true }).selectOption("85");
    await page.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await node
      .getByRole("button", { name: "Gửi tạo ảnh", exact: true })
      .click();
    await page
      .waitForFunction(
        () => document.querySelectorAll(".node-results button").length === 2,
      )
      .catch(async (e) => {
        console.log(
          "Fixture sends",
          sent.length,
          await page.locator(".inline-status").allTextContents(),
          await page.evaluate(async () => {
            const { list } = await import("./core/storage.js");
            return (await list("jobs")).map((j) => ({
              status: j.status,
              error: j.error,
            }));
          }),
        );
        throw e;
      });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].quality, "high");
    assert.match(sent[0].prompt, /85 mm/);
    assert.match(sent[0].prompt, /điện ảnh/i);
    assert.notEqual(sent[0].requestId, sent[1].requestId);
    await node.locator("img").waitFor();
    await node.locator(".cvn-node-body img").click();
    await page.locator(".cvn-image-toolbar:not([hidden])").waitFor();
    await page.getByLabel("Điều chỉnh mức thu phóng", { exact:true }).click();
    await page.getByRole("button", { name: "Vừa khung", exact: true }).click();
    if (process.env.REVIEW_DIR) {
      await fs.mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "image-toolbar-preview.png"),
      });
    }
    const backup = await page.evaluate(async (id) => {
      const { ProjectRepository } = await import("./core/projects.js"),
        { exportBundle, importBundle } = await import("./core/backup.js"),
        { remove } = await import("./core/storage.js");
      const project = await new ProjectRepository().get(id),
        restored = await importBundle(await exportBundle(project)),
        node = restored.project.graph.nodes.find(
          (n) => n.type === "generateImage",
        ),
        ids = JSON.parse(node.data.resultAssets);
      for (const a of restored.created)
        await remove(a.source === "upload" ? "inputs" : "results", a.id);
      return {
        count: ids.length,
        fresh: ids.every(
          (id) =>
            !JSON.parse(project.graph.nodes[0].data.resultAssets).includes(id),
        ),
      };
    }, id);
    assert.deepEqual(backup, { count: 2, fresh: true });
    const labels = await page
      .locator(".cvn-dock > button")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
    assert.deepEqual(labels, [
      "Di chuyển (V)",
      "Phong cách",
      "Kho",
      "Công cụ",
      "Lịch sử",
      "Phím tắt",
      "Trợ giúp",
    ]);
    assert.equal(await page.locator(".cvn-orb").count(), 1);
    await page.getByRole("button", { name: "Phím tắt", exact: true }).click();
    await page.locator(".shortcut-grid").waitFor();
    await page
      .locator(".cvn-resource-sheet")
      .getByRole("button", { name: "Đóng", exact: true })
      .click();
    await page.getByRole("button", { name: "Xem lớn", exact: true }).click();
    await page.locator(".image-workbench img").waitFor();
    await page
      .locator(".image-workbench")
      .getByRole("button", { name: "×", exact: true })
      .click();
    for (const name of ["HD AI", "Tách lớp AI", "Tạo panorama", "Nhiều góc nhìn", "Chỉnh vùng AI"])
      assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0);
    await page.getByRole("button", { name: "Chia lưới", exact: true }).click();
    await page
      .getByRole("button", { name: "Đưa ô đã chọn lên canvas", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".cvn-node").length === 5,
    );
    await node.locator(".cvn-node-title").click();
    await page.getByRole("button", { name: "Xoay", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".cvn-node").length === 6,
    );
    await node.locator(".cvn-node-title").click();
    await page.getByRole("button", { name: "Vẽ", exact: true }).click();
    const canvas = page.locator(".image-workbench canvas");
    const r = await canvas.boundingBox();
    await page.mouse.move(r.x + 4, r.y + 4);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.7, r.y + r.height * 0.7, {
      steps: 6,
    });
    await page.mouse.up();
    await page
      .getByRole("button", { name: "Lưu ảnh đánh dấu", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".cvn-node").length === 7,
    );
    assert.equal(sent.length, 2, "Local tools never send AI requests");
    await page.getByLabel("Điều chỉnh mức thu phóng", { exact:true }).click();
    await page.getByRole("button", { name: "Vừa khung", exact: true }).click();
    if (process.env.REVIEW_DIR) {
      await fs.mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.evaluate(() => {
        document.getElementById("toast").hidden = true;
      });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "image-tools-and-dock.png"),
      });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS image controls: exact dock order; quality/style/camera and two distinct image jobs; gallery; selected grid tiles; rotation; annotation; unsupported AI tools hidden; no extra AI calls.",
    );
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
