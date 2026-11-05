import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ChromeConnection } from "./server/connection.mjs";
import { ServerJobs } from "./server/jobs.mjs";
import { apiProviders, generateAPI } from "./server/providers.mjs";
const root = process.cwd(),
  host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 4174),
  runtime = resolve(root, ".mooz-runtime");
if (
  !["127.0.0.1", "localhost"].includes(host) &&
  !process.env.MOOZ_ACCESS_TOKEN
)
  throw Error("Đặt MOOZ_ACCESS_TOKEN trước khi mở máy chủ ra mạng.");
const chrome = new ChromeConnection(runtime);
await chrome.init();
const jobs = new ServerJobs(
  resolve(runtime, "requests"),
  async (input, sent) => {
    if (
      !["text", "image", "video"].includes(input.mediaType) ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 50000
    )
      throw Error("Yêu cầu không hợp lệ.");
    if (
      input.referenceImages &&
      (!Array.isArray(input.referenceImages) ||
        input.referenceImages.length > 8 ||
        input.referenceImages.some(
          (v) =>
            typeof v !== "string" ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
        ))
    )
      throw Error("Ảnh tham chiếu không hợp lệ.");
    if (apiProviders[input.provider]) {
      if (
        !process.env[apiProviders[input.provider].key] ||
        !apiProviders[input.provider].types.includes(input.mediaType)
      )
        throw Error("Chưa cấu hình API phù hợp.");
      await sent();
      return generateAPI(input);
    }
    if (
      !["muse", "gemini", "chatgpt", "grok", "flow"].includes(input.provider) ||
      !Number.isSafeInteger(input.tabId)
    )
      throw Error("Chọn AI và tab đã kết nối.");
    await chrome.check(input);
    await sent();
    return chrome.generate(input);
  },
);
const staticFiles = new Set([
  "index.html",
  "style.css",
  "app.js",
  "projects-ui.js",
  "studio.js",
  "video-prompt.js",
  "canvas-menu.js",
  "canvas-navigation.js",
  "canvas-libraries.js",
  "modules.js",
  "jobs-ui.js",
  "core/graph.js",
  "core/projects.js",
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
  "client-api.js",
]);
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 30 * 1024 * 1024) throw Error("Dữ liệu gửi vượt 30 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  try {
    const url = new URL(req.url, "http://localhost"),
      path = decodeURIComponent(url.pathname);
    if (path.startsWith("/api/")) {
      if (
        req.headers["x-mooz-client"] !== "web" ||
        (req.headers.origin &&
          req.headers.origin !== "http://" + req.headers.host &&
          req.headers.origin !== "https://" + req.headers.host)
      )
        return json(res, 403, { error: "Nguồn yêu cầu không hợp lệ." });
      if (
        process.env.MOOZ_ACCESS_TOKEN &&
        !equal(req.headers["x-mooz-access"], process.env.MOOZ_ACCESS_TOKEN)
      )
        return json(res, 401, {
          error: "Nhập mã truy cập máy chủ trong Cài đặt.",
        });
      if (path === "/api/status" && req.method === "GET")
        return json(res, 200, {
          chrome: chrome.status(),
          providers: Object.entries(apiProviders).map(([id, p]) => ({
            id,
            name: p.name,
            types: p.types,
            ready: !!process.env[p.key],
            operations: p.types.map((type) => type + ".generate"),
          })),
        });
      if (path === "/api/tabs" && req.method === "GET")
        return json(
          res,
          200,
          await chrome.tabs(url.searchParams.get("provider")),
        );
      if (path === "/api/chrome/pair" && req.method === "POST")
        return json(res, 200, await chrome.pair());
      if (path === "/api/chrome/resume" && req.method === "POST") {
        const input = await body(req);
        await chrome.check(input);
        await chrome.dispatch.resume(input.provider);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/chrome/disconnect" && req.method === "POST") {
        chrome.relay.revokeLocal();
        chrome.relay.revokeRemote();
        await chrome.broker.stop();
        return json(res, 200, { ok: true });
      }
      if (path === "/api/jobs" && req.method === "POST")
        return json(res, 200, await jobs.run(await body(req)));
      if (path.startsWith("/api/jobs/") && req.method === "GET") {
        const record = await jobs.get(path.slice(10));
        return json(
          res,
          record ? 200 : 404,
          record || {
            error: "Không có lượt này trên máy chủ. Chưa tự gửi lại.",
          },
        );
      }
      return json(res, 404, { error: "Không có API này." });
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed" });
    if (path === "/downloads/MooZ-Connect.zip") {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="MooZ-Connect.zip"',
      });
      return res.end(
        await readFile(resolve(root, "vendor/mooz/Workflow-Connect.zip")),
      );
    }
    const file = path === "/" ? "index.html" : path.slice(1);
    if (!staticFiles.has(file)) return json(res, 404, { error: "Not found" });
    const data = await readFile(resolve(root, file));
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[
          extname(file)
        ] + "; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (e) {
    json(res, 400, { error: String(e.message || e).slice(0, 1000) });
  }
});
server.requestTimeout = 0;
server.listen(port, host, () => console.log("MooZ CVN server on port " + port));
const close = () => {
  void chrome.close().finally(() => {
    server.close();
    server.closeAllConnections();
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
