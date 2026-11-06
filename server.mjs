import {CustomProviders} from './server/custom-providers.mjs';
import {diagnosticSnapshot} from './server/diagnostics.mjs';
import {reconcileMedia,falTools} from './server/remote-media.mjs';
import {APISettings} from './server/api-settings.mjs';
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ChromeConnection } from "./server/connection.mjs";
import { ServerJobs } from "./server/jobs.mjs";
import { apiProviders, generateAPI, validateAPIInput } from "./server/providers.mjs";
import { speechAPI, validateSpeech } from "./server/speech.mjs";
import { AssistantTab } from "./server/assistant-tab.mjs";
const root = process.cwd(),
  host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 4174),
  runtime = resolve(process.env.MOOZ_RUNTIME_DIR || resolve(root, ".mooz-runtime"));
if (
  !["127.0.0.1", "localhost"].includes(host) &&
  !process.env.MOOZ_ACCESS_TOKEN
)
  throw Error("Đặt MOOZ_ACCESS_TOKEN trước khi mở máy chủ ra mạng.");
const providerSettings=new APISettings(runtime);await providerSettings.init();const customProviders=new CustomProviders(runtime);await customProviders.init();
const chrome = new ChromeConnection(runtime);
await chrome.init();
const assistantTab = new AssistantTab(runtime);
await assistantTab.init();
let chromeConfigBusy = false;
const chromeConfiguration = async action => {
  if(chromeConfigBusy)throw Error('Đang xử lý cấu hình Chrome; đợi thao tác hiện tại kết thúc.');
  if(jobs.active.size)throw Error('Chờ các yêu cầu đang chạy kết thúc trước khi đổi hoặc kiểm tra kết nối Chrome.');
  chromeConfigBusy=true;
  try{return await action();}finally{chromeConfigBusy=false;}
};
const jobs = new ServerJobs(
  resolve(runtime, "requests"),
  async (input, sent) => {
    if (["voiceover", "transcribe"].includes(input.operation)) { const env=providerSettings.env();validateSpeech(input,env); await sent(); return speechAPI(input,{env}); }
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
    const referenceSizes=(input.referenceImages||[]).map(value=>Buffer.byteLength(value.slice(value.indexOf(',')+1),'base64'));
    if(referenceSizes.some(size=>size>8*1024*1024)||referenceSizes.reduce((sum,size)=>sum+size,0)>32*1024*1024)throw Error('Ảnh tham chiếu vượt giới hạn 8 MB/ảnh hoặc tổng 32 MB.');
    if(customProviders.get(input.provider)){customProviders.checkInput(input);await sent();return customProviders.generate(input);}
    if (apiProviders[input.provider]) {
      if (
        !providerSettings.env()[apiProviders[input.provider].key] ||
        !apiProviders[input.provider].types.includes(input.mediaType)
      )
        throw Error("Chưa cấu hình API phù hợp.");
      const env=providerSettings.env();validateAPIInput(input,env);
      await sent();
      return generateAPI(input,{env,checkpoint:sent});
    }
    if (
      !["muse", "gemini", "chatgpt", "grok", "flow"].includes(input.provider) ||
      !Number.isSafeInteger(input.tabId)
    )
      throw Error("Chọn AI và tab đã kết nối.");
    if(chromeConfigBusy)throw Error("Kết nối Chrome đang được cấu hình; chưa gửi AI.");
    assistantTab.assertJob(input);
    await chrome.check(input);
    assistantTab.assertJob(input);
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
  "assistant-ui.js",
  "modules.js",
  "flow-workbench.js",
  "workflow-exchange-ui.js",
  "core/workflow-exchange.js",
  "jobs-ui.js",
  "core/graph.js",
  "core/tab-binding.js",
  "core/projects.js",
  "core/storage.js",
  "core/runner.js",
  "core/backup.js",
  "core/license.js",
  "core/capabilities.js",
  "core/provider-capabilities.js",
  "core/references.js",
  "core/assistant-tab.js",
  "media-tools.js",
  "image-workbench.js",
  "advanced-image-workbench.js",
  "icons.js",
  "post-workbench.js",
  "finishing-workbench.js",
  "core/finishing-plan.js",
  "relay-settings-ui.js",
  "api-settings-ui.js",
  "custom-providers-ui.js",
  "maintenance-ui.js",
  "core/diagnostics.js",
  "depth-worker.js",
  "depth-workbench.js",
  "core/depth-video.js",
  "vendor/depth/model-small.onnx",
  "vendor/depth/ort.wasm.bundle.min.mjs",
  "vendor/depth/ort-wasm-simd-threaded.mjs",
  "vendor/depth/ort-wasm-simd-threaded.wasm",
  "downloads/release.json",
  "core/queue-plan.js",
  "core/output-state.js",
  "core/flow-plan.js",
  "core/workflow-recipe.js",
  "core/character-samples.js",
  "vendor/characters/catalog.json",
  "vendor/characters/LICENSE.txt",
  "vendor/characters/CC-BY-4.0.txt",
  "vendor/characters/adventurer-1.png",
  "vendor/characters/adventurer-2.png",
  "vendor/characters/adventurer-3.png",
  "vendor/characters/adventurer-4.png",
  "vendor/characters/adventurer-5.png",
  "vendor/characters/adventurer-6.png",
  "core/queue-storage.js",
  "core/queue-runner.js",
  "core/local-media.js",
  "core/media-preview.js",
  "vendor/mooz/workflow-runtime.js",
  "vendor/mooz/media-studio.js",
  "vendor/mooz/ffmpeg/ffmpeg.js",
  "vendor/mooz/ffmpeg/814.ffmpeg.js",
  "vendor/mooz/ffmpeg/ffmpeg-core.js",
  "vendor/mooz/ffmpeg/ffmpeg-core.wasm",
  "vendor/mooz/fonts/DejaVuSans.ttf",

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
    if (size > 50 * 1024 * 1024) throw Error("Dữ liệu gửi vượt 50 MB.");
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
      if (path === "/api/speech" && req.method === "POST") {
        const input = await body(req);
        validateSpeech(input,providerSettings.env());
        return json(res, 200, await jobs.run({ requestId: input.requestId, provider: 'openai', operation: input.operation, text: input.text || '', data: input.data || '', settings: input.settings || {} }));
      }
      if(path==='/api/providers/custom'&&req.method==='GET')return json(res,200,customProviders.snapshot());
      if(path==='/api/providers/custom'&&req.method==='POST'){if(jobs.active.size)throw Error('Đợi job đang chạy kết thúc trước khi sửa AI.');const input=await body(req);return json(res,200,input.remove?await customProviders.remove(input.id):await customProviders.save(input));}
      if(path==='/api/providers/custom/test'&&req.method==='POST')return json(res,200,await customProviders.test(await body(req)));
      if(path==='/api/providers/config'&&req.method==='GET')return json(res,200,providerSettings.snapshot());
      if(path==='/api/providers/config'&&req.method==='POST'){if(jobs.active.size)throw Error('Chờ tác vụ đang chạy kết thúc trước khi đổi khóa/model.');return json(res,200,await providerSettings.save(await body(req)));}
      if(path==='/api/providers/test'&&req.method==='POST')return json(res,200,await providerSettings.test(await body(req)));
      if(path==='/api/diagnostics'&&req.method==='GET'){const version=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version,release=JSON.parse(await readFile(resolve(root,'downloads/release.json'),'utf8'));return json(res,200,diagnosticSnapshot({version,release,chrome,providers:{snapshot:()=>({providers:[...providerSettings.snapshot().providers,...customProviders.snapshot().providers.map(p=>({id:p.id,keyConfigured:p.keyConfigured,models:{text:p.model}}))]})},requests:await jobs.diagnostics(),host,port,active:jobs.active.size}));}
      if (path === "/api/status" && req.method === "GET")
        return json(res, 200, {
          chrome: chrome.status(),
          assistantTab: assistantTab.snapshot(),
          providers: [...Object.entries(apiProviders).map(([id, p]) => ({
            id,
            name: p.name,
            types: p.types,
            ready: !!providerSettings.env()[p.key],
            operations: [...p.types.map(type=>type+".generate"),...(id==="fal"?Object.keys(falTools):[])],
          })),...customProviders.snapshot().providers.map(({id,name,types,ready,custom,vision})=>({id,name,types,ready,custom,vision}))],
        });
      if (path === "/api/tabs" && req.method === "GET")
        return json(
          res,
          200,
          (await chrome.tabs(url.searchParams.get("provider"))).filter(tab => url.searchParams.get("purpose") === "assistant-setup" || tab.id !== assistantTab.snapshot()?.tabId).map(tab => ({ ...tab, busy: jobs.resources.has("tab:" + tab.id) })),
        );
      if (path === "/api/assistant/config" && req.method === "GET")
        return json(res, 200, { assistantTab: assistantTab.snapshot() });
      if (path === "/api/assistant/config" && req.method === "POST") {
        const input = await body(req);
        if (!Object.hasOwn(input, "tab")) throw Error("Thiếu lựa chọn tab trợ lý.");
        const selection = await assistantTab.configure(input.tab, {
          check: value => chrome.check(value),
          isBusy: id => jobs.resources.has("tab:" + id),
        });
        return json(res, 200, { assistantTab: selection });
      }
      if (path === "/api/assistant/messages" && req.method === "POST") {
        const input = await body(req), selected = assistantTab.snapshot();
        if (!selected) throw Error("Chọn tab Trợ lý AI trong Cài đặt trước.");
        const actual = (await chrome.tabs(selected.provider)).find(tab => tab.id === selected.tabId);
        if (!actual) throw Error("Tab trợ lý không còn kết nối. Kiểm tra lại trong Cài đặt.");
        return json(res, 200, await jobs.run({ requestId: input.requestId, prompt: input.prompt, purpose: "assistant", mediaType: "text", provider: selected.provider, tabId: selected.tabId, chatURL: actual.url }));
      }
      if(path === '/api/chrome/config' && req.method === 'GET')return json(res,200,chrome.settings.snapshot());
      if(path === '/api/chrome/config' && req.method === 'POST') {
        const input=await body(req);return json(res,200,await chromeConfiguration(()=>chrome.configure(input)));
      }
      if(path === '/api/chrome/test-relay' && req.method === 'POST') {
        const input=await body(req);return json(res,200,await chromeConfiguration(()=>chrome.testRelay(input)));
      }
      if (path === "/api/chrome/pair" && req.method === "POST")
        return json(res, 200, await chromeConfiguration(()=>chrome.pair()));
      if (path === "/api/chrome/resume" && req.method === "POST") {
        const input = await body(req);
        await chrome.check(input);
        await chrome.dispatch.resume(input.provider);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/chrome/disconnect" && req.method === "POST") {
        await chromeConfiguration(()=>chrome.disconnect());
        return json(res, 200, { ok: true });
      }
      if (path === "/api/jobs" && req.method === "POST")
        return json(res, 200, await jobs.run({ ...await body(req), purpose: "workflow" }));
      if (path.startsWith("/api/jobs/") && req.method === "GET") {
        let record = await jobs.get(path.slice(10));
        if(record?.remote&&!jobs.active.has(record.id)&&record.status!=="success")try{record=await jobs.reconcile(record.id,remote=>reconcileMedia(remote,{env:providerSettings.env()}));}catch(error){record={...record,error:error.message};}
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
    const binary = [".wasm", ".onnx", ".ttf"].includes(extname(file));
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
      ".mjs": "text/javascript", ".onnx": "application/octet-stream", ".wasm": "application/wasm", ".ttf": "font/ttf", ".json": "application/json" }[
          extname(file)
        ] + (binary ? "" : "; charset=utf-8"),
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
