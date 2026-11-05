const { chromium } = require("playwright"),
  { spawn, execFileSync } = require("node:child_process"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cvn-inline-")),
    file = path.join(dir, "video.mp4"),
    port = 4194,
    url = "http://127.0.0.1:" + port;
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
    file,
  ]);
  const video =
    "data:video/mp4;base64," + (await fs.readFile(file)).toString("base64");
  const server = spawn(process.execPath, ["server.mjs"], {
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
        viewport: { width: 1500, height: 1000 },
      }),
      errors = [],
      sent = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route('**/api/status',route=>route.fulfill({json:{providers:[{id:'openai',ready:true,types:['text','image']}],chrome:{connected:true}}}));
    await page.goto(url);
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const x = c.getContext("2d");
      x.fillStyle = "#455c53";
      x.fillRect(0, 0, 640, 360);
      x.fillStyle = "#d5dfcf";
      x.font = "40px sans-serif";
      x.fillText("MooZ CVN", 180, 190);
      return c.toDataURL();
    });
    await page.route("**/api/tabs?*", (r) =>
      r.fulfill({
        json: [
          {
            id: 8,
            title: "Tab kiểm chứng",
            url: "https://grok.com/chat/fixture",
          },
        ],
      }),
    );
    await page.route("**/api/jobs", async (r) => {
      const input = r.request().postDataJSON();
      sent.push(input);
      await r.fulfill({
        json: {
          id: input.requestId,
          status: "success",
          result: {
            kind: input.mediaType,
            url: input.mediaType === "video" ? video : image,
          },
        },
      });
    });
    await page.getByRole("button", { name: "＋ Tạo dự án" }).click();
    await page.locator("dialog[open] input").fill("Studio mới");
    await page.getByRole("button", { name: "Lưu dự án", exact: true }).click();
    await page.waitForURL(/#project\//);
    await page.getByRole("button", { name: "Mở Canvas" }).click();
    await page.locator(".cvn-studio").waitFor();
    await page.getByLabel("Thêm vào canvas", { exact: true }).click();
    await page.getByRole("button", { name: "Ảnh", exact: true }).click();
    const imageNode = page.locator(".generation-node").first();
    await imageNode
      .getByLabel("Nội dung yêu cầu", { exact: true })
      .fill("Ảnh từ prompt bên dưới");
    await imageNode
      .getByLabel("AI thực hiện", { exact: true })
      .selectOption("openai");
    let body = await imageNode.locator(".cvn-node-body").boundingBox(),
      composer = await imageNode.locator(".inline-composer").boundingBox();
    assert.ok(composer.y >= body.y + body.height);
    assert.equal(await page.locator(".cvn-composer").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Thiết lập", exact: true })
        .count(),
      0,
    );
    await imageNode
      .getByRole("button", { name: "Gửi tạo ảnh", exact: true })
      .click();
    await imageNode.locator("img").waitFor();
    assert.equal(sent[0].prompt, "Ảnh từ prompt bên dưới");
    await page.getByLabel("Thêm vào canvas", { exact: true }).click();
    await page.getByRole("button", { name: "Video", exact: true }).click();
    const videoNode = page.locator(".generation-node").last();
    const dragTitle=await videoNode.locator('.cvn-node-title').boundingBox();await page.mouse.move(dragTitle.x+30,dragTitle.y+10);await page.mouse.down();await page.mouse.move(dragTitle.x+630,dragTitle.y+10,{steps:5});await page.mouse.up();
    await page.mouse.move(1400,100);await page.mouse.down({button:'middle'});await page.mouse.move(1220,100,{steps:5});await page.mouse.up({button:'middle'});
    assert.equal(await page.locator('.cvn-node').count(),2,'middle mouse does not paste a phantom node');
    await videoNode.locator('.cvn-node-title').click();

    await videoNode
      .getByLabel("Nội dung yêu cầu", { exact: true })
      .fill("Video từ prompt bên dưới");
    await videoNode
      .getByLabel("AI thực hiện", { exact: true })
      .selectOption("grok");
    await videoNode.locator(".inline-connection").evaluate(menu=>{menu.open=true;});
    await videoNode
      .getByLabel("Tab chạy luồng", { exact: true })
      .selectOption("8");
    await videoNode
      .getByRole("button", { name: "Gửi tạo video", exact: true })
      .click();
    await videoNode.locator("video").waitFor();
    assert.equal(sent[1].tabId, 8);
    assert.equal(sent[1].prompt, "Video từ prompt bên dưới");
    await page.getByLabel("Điều chỉnh mức thu phóng", { exact:true }).click();
    await page.getByRole("button", { name: "Vừa khung", exact: true }).click();
    assert.equal(await page.locator(".inline-composer:visible").count(), 1);
    await imageNode.locator(".cvn-node-title").click({ modifiers: ["Shift"] });
    assert.equal(await page.locator(".cvn-node.selected").count(), 1);
    assert.equal(await page.locator(".inline-composer:visible").count(), 1);
    assert.equal(await imageNode.locator(".inline-composer").isVisible(), true);
    assert.equal(await page.locator(".cvn-image-toolbar").isVisible(), true);
    await imageNode.locator(".inline-settings summary").click();
    for (const ratio of ["9:16", "1:1", "21:9"]) {
      await imageNode.getByRole("button", { name: "Khung " + ratio, exact: true }).click();
      const measured = await imageNode.locator(".cvn-node-body").evaluate(e => e.offsetWidth / e.offsetHeight);
      const [w, h] = ratio.split(":").map(Number);
      assert.ok(Math.abs(measured - w / h) < .03, `${ratio} frame changes immediately`);
    }
    await imageNode.locator(".inline-settings summary").click();
    await videoNode.locator(".cvn-node-title").click({ modifiers: ["Shift"] });
    assert.equal(await page.locator(".cvn-node.selected").count(), 1);
    assert.equal(await imageNode.locator(".inline-composer").isVisible(), false);
    assert.equal(await page.locator(".cvn-video-toolbar").isVisible(), true);
    await page.locator(".cvn-viewport").click({ position: { x: 15, y: 150 } });
    assert.equal(await page.locator(".cvn-node.selected").count(), 0);
    assert.equal(await page.locator(".inline-composer:visible").count(), 0);
    assert.equal(await page.locator(".cvn-image-toolbar").isVisible(), false);
    // Wait for the debounced project write before verifying restoration.
    let saved = false;
    for (let attempt=0;attempt<50;attempt++) {
      saved=await page.evaluate(async()=>{const {ProjectRepository}=await import('./core/projects.js');return(await new ProjectRepository().get(location.hash.split('/').pop())).graph.nodes.find(n=>n.type==='generateImage').data.size==='21:9';});
      if(saved)break;await page.waitForTimeout(50);
    }
    assert.equal(saved,true,'latest frame ratio is durably stored');
    await page.reload();
    await page.locator(".generation-node video").waitFor();
    assert.equal(await page.locator(".inline-composer:visible").count(), 0);
    assert.equal(await page.locator(".cvn-image-toolbar").isVisible(), false);
    const restored = await imageNode.locator(".cvn-node-body").evaluate(e => e.offsetWidth / e.offsetHeight);
    assert.ok(Math.abs(restored - 21 / 9) < .03);
    assert.equal(await imageNode.locator("img").evaluate(e => e.naturalWidth), 640);

    assert.equal(
      await page.locator(".generation-node .inline-composer").count(),
      2,
    );
    assert.equal(
      await page
        .locator(".generation-node")
        .first()
        .getByLabel("Nội dung yêu cầu", { exact: true })
        .inputValue(),
      "Ảnh từ prompt bên dưới",
    );
    if (process.env.REVIEW_DIR) {
      await fs.mkdir(process.env.REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.REVIEW_DIR, "inline-image-video.png"),
      });
    }
    await page.getByLabel('Điều chỉnh mức thu phóng',{exact:true}).click();await page.getByRole('button',{name:'Vừa khung',exact:true}).click();
    const sourcePort=page.getByRole('button',{name:'Đầu ra Tạo ảnh',exact:true}),point=await sourcePort.boundingBox();await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await sourcePort.click();
    await page
      .locator(".port-menu")
      .getByRole("button", { name: "Tạo video", exact: true }).last()
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".generation-node").length === 3,
    );
    assert.equal(await page.locator(".cvn-wires g[data-edge-id]").count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS inline media: prompt is below image/video; no old setup buttons or dialog; exact prompt and tab submitted; decoded image/video returned; prompt and results persist after reload. Fixture AI only.",
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
