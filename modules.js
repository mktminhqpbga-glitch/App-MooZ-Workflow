import {mountCustomProviders} from './custom-providers-ui.js';
import {isAPIProvider} from './client-api.js';
import {mountMaintenance} from './maintenance-ui.js';
import {generationCapabilities} from './core/provider-capabilities.js';
import {mountAPISettings} from './api-settings-ui.js';
import {compileRecipe} from './core/workflow-recipe.js';
import {openFlowEditor,openFlowLibrary} from './flow-workbench.js';
import { mountRelaySettings } from "./relay-settings-ui.js";
import { mountAssistantSettings } from "./assistant-ui.js";
import { icon } from "./icons.js";
import {
  advancedImageOperations,
  readyOperations,
} from "./core/capabilities.js";
import { editImage, captureFrame } from "./media-tools.js";
import { nodeAssetIds } from "./core/references.js";
import { el, button, notice, api, providerList, connectedAI } from "./client-api.js";
import {
  list,
  read,
  write,
  remove,
  addAsset,
  readAsset,
  listAssets,
} from "./core/storage.js";
import { ProjectRepository } from "./core/projects.js";
import {
  createJob,
  startJob,
  stopJob,
  inspectJob,
  recoverJobs,
} from "./core/runner.js";
import { prepareJobs } from "./core/queue-storage.js";
import { splitPrompts, uniqueTags, validateImage, limits } from "./core/queue-plan.js";
import { buildFlow, buildContinuation, buildFirstLast } from "./core/flow-plan.js";
import { queueRunner } from "./core/queue-runner.js";
import { resumeJob } from "./core/runner.js";
import { emptyGraph } from "./core/graph.js";
const repo = new ProjectRepository(),
  titles = {
    inputs: "Đầu vào",
    results: "Kết quả",
    prompts: "Prompt",
    templates: "Luồng mẫu",
  };
export async function mountLibrary(host) {
  let category = "inputs",
    kind = "all",
    query = "",
    alive = true,
    urls = [];
  const top = el("div", undefined, "section-title");
  top.append(el("h1", "Kho"));
  const tabs = el("nav", undefined, "library-tabs");
  tabs.setAttribute("aria-label", "Các khu trong Kho");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Tìm trong khu đang mở…";
  search.setAttribute("aria-label", "Tìm trong Kho");
  const filter = el("select");
  for (const [v, l] of [
    ["all", "Tất cả loại"],
    ["image", "Ảnh"],
    ["video", "Video"],
    ["audio", "Âm thanh"],
  ])
    filter.add(new Option(l, v));
  const tools = el("div", undefined, "project-actions"),
    cards = el("div", undefined, "library-grid");
  const uploader = el("input");
  uploader.type = "file";
  uploader.multiple = true;
  uploader.accept = "image/*,video/*,audio/*";
  uploader.hidden = true;
  uploader.onchange = async () => {
    try {
      for (const file of uploader.files) await addAsset(file);
      await render();
    } catch (e) {
      notice(e.message);
    }
    uploader.value = "";
  };
  const create = button("＋ Tải đầu vào", () => uploader.click());
  tools.append(search, filter, create, uploader);
  host.replaceChildren(top, tabs, tools, cards);
  for (const [key, label] of Object.entries(titles)) {
    const b = button(label, async () => {
      category = key;
      query = "";
      search.value = "";
      await render();
    });
    b.dataset.category = key;
    tabs.append(b);
  }
  search.oninput = () => {
    query = search.value.toLowerCase();
    void render();
  };
  filter.onchange = () => {
    kind = filter.value;
    void render();
  };
  let revision = 0;
  async function render() {
    const seq = ++revision,
      items = await list(category);
    if (!alive || seq !== revision) return;
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    cards.replaceChildren();
    filter.hidden = !["inputs", "results"].includes(category);
    create.hidden = category !== "inputs" && category !== "prompts";
    create.textContent =
      category === "inputs" ? "＋ Tải đầu vào" : "＋ Lưu prompt";
    create.onclick = async () => {
      if (category === "inputs") uploader.click();
      else promptDialog(null);
    };
    for (const b of tabs.children)
      b.setAttribute(
        "aria-current",
        b.dataset.category === category ? "page" : "false",
      );
    for (const item of items
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .filter(
        (a) =>
          a.name.toLowerCase().includes(query) &&
          (!["inputs", "results"].includes(category) ||
            kind === "all" ||
            a.kind === kind),
      )) {
      const card = el("article", undefined, "library-card");
      if (item.blob) {
        const visual = el(item.kind === "image" ? "img" : item.kind);
        visual.src = URL.createObjectURL(item.blob);
        urls.push(visual.src);
        if (item.kind !== "image") {
          visual.controls = true;
          visual.preload = "metadata";
        } else visual.alt = item.name;
        card.append(visual);
      } else
        card.append(
          el(
            "p",
            category === "prompts"
              ? item.text
              : (item.graph?.nodes.length || 0) +
                  " node · " +
                  (item.graph?.edges.length || 0) +
                  " dây",
            "library-text",
          ),
        );
      card.append(el("strong", item.name));
      const actions = el("div", undefined, "project-actions");
      actions.append(
        button("Đổi tên", () => {
          const next = prompt("Tên mới", item.name);
          if (next?.trim()) {
            return write(category, {
              ...item,
              name: next.trim().slice(0, 100),
            }).then(render);
          }
        }),
      );
      if (item.kind === "image")
        actions.append(
          button("Chỉnh ảnh", () => editImage(item, () => render())),
        );
      if (item.kind === "video")
        actions.append(
          button("Lấy khung hình", async () => {
            await captureFrame(
              item,
              card.querySelector("video")?.currentTime || 0,
            );
            await render();
            notice("Đã lưu khung hình vào Kho Kết quả");
          }),
        );
      if (item.blob)
        actions.append(
          button("Tải xuống", () => {
            const a = el("a");
            a.href = URL.createObjectURL(item.blob);
            a.download = item.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }),
        );
      if (category === "prompts")
        actions.append(button("Sửa prompt", () => promptDialog(item)));
      actions.append(
        button("Xóa", async () => {
          if (item.blob) {
            const used = (await repo.list()).filter((p) =>
              p.graph.nodes.some(
                (n) => nodeAssetIds(n).includes(item.id),
              ),
            );
            const people = (await list("characters")).filter(
              (p) => p.assetId === item.id,
            );
            if (people.length) {
              notice(
                "Ảnh đang dùng cho nhân vật: " +
                  people.map((p) => p.name).join(", ") +
                  ". Xóa liên kết trong thư viện nhân vật trước.",
              );
              return;
            }
            if (used.length) {
              notice(
                "Đang dùng trong: " +
                  used.map((p) => p.name).join(", ") +
                  ". Hãy bỏ nguồn khỏi dự án trước khi xóa.",
              );
              return;
            }
          }
          if (
            !confirm("Xóa “" + item.name + "” khỏi " + titles[category] + "?")
          )
            return;
          await remove(category, item.id);
          await render();
        }),
      );
      card.append(actions);
      cards.append(card);
    }
    if (!cards.childNodes.length)
      cards.append(
        el("p", "Chưa có mục nào trong " + titles[category] + ".", "intro"),
      );
  }
  function promptDialog(item) {
    const d = el("dialog"),
      form = el("form"),
      name = el("input"),
      text = el("textarea");
    name.required = true;
    name.placeholder = "Tên prompt";
    name.setAttribute("aria-label", "Tên prompt");
    name.maxLength = 100;
    name.value = item?.name || "";
    text.required = true;
    text.placeholder = "Nội dung prompt";
    text.setAttribute("aria-label", "Nội dung prompt");
    text.maxLength = 50000;
    text.value = item?.text || "";
    const save = el("button", "Lưu");
    save.type = "submit";
    form.append(
      el("h2", "Kho Prompt"),
      name,
      text,
      save,
      button("Hủy", () => d.close()),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await write("prompts", {
          id: item?.id || crypto.randomUUID(),
          name: name.value.trim(),
          text: text.value,
          createdAt: item?.createdAt || new Date().toISOString(),
        });
        d.close();
        await render();
      } catch (e) {
        notice(e.message);
      } finally {
        save.disabled = false;
      }
    };
    d.append(form);
    document.body.append(d);
    d.onclose = () => d.remove();
    d.showModal();
  }
  await render();
  return () => {
    alive = false;
    urls.forEach(URL.revokeObjectURL);
  };
}
export async function mountSettings(host) {
  host.replaceChildren(
    el("h1", "Cài đặt"),
    el(
      "p",
      "Quản lý giao diện, không gian cá nhân và kết nối AI.",
      "intro",
    ),
  );
  const preferences = el("section", undefined, "settings-panel workspace-preferences"),
    identity = el("div", undefined, "workspace-identity"),
    appearanceLink = el("a", "Tùy chỉnh giao diện →", "workspace-appearance-link");
  identity.append(el("span", "M", "avatar"), el("span", "Không gian cá nhân"));
  appearanceLink.href = "#appearance";
  preferences.append(el("h2", "Không gian và giao diện"), identity, appearanceLink);
  host.append(preferences);
  mountAssistantSettings(host);
  const cleanupAPI=mountAPISettings(host);
  const cleanupCustom=mountCustomProviders(host);
  const cleanupMaintenance=mountMaintenance(host);
  const downloads = el('section', undefined, 'settings-panel app-downloads');
  downloads.append(el('h2','Ứng dụng & extension'));
  const installed = el('p', globalThis.moozDesktop ? 'MooZ CVN ' + globalThis.moozDesktop.version + ' · ' + globalThis.moozDesktop.platform + ' ' + globalThis.moozDesktop.arch : 'Bạn đang dùng bản web. Bản desktop có máy chủ kết nối AI local.');
  const extension = el('a','Tải MooZ Connect mới nhất'), mac = el('a','Tải ứng dụng macOS Intel'), releaseState = el('p','Đang kiểm tra phiên bản phát hành…');
  extension.href='/downloads/MooZ-Connect.zip'; extension.download='MooZ-Connect.zip';
  mac.href='https://github.com/mktminhqpbga-glitch/App-MooZ-Workflow/releases/latest'; mac.target='_blank'; mac.rel='noopener';
  downloads.append(installed,extension,mac,releaseState,el('p','Mac Intel (x64). Bản chưa ký/notarize cần được xác nhận mở trong macOS. Extension: giải nén → Chrome → Extensions → Developer mode → Load unpacked.'));
  host.append(downloads);
  void fetch('/downloads/release.json').then(response=>{if(!response.ok)throw Error('Không đọc được phiên bản');return response.json();}).then(info=>{extension.textContent='Tải MooZ Connect '+info.extensionVersion;releaseState.textContent='Mã nguồn app '+info.appVersion+' · bản Mac công khai xem trên trang phát hành.';}).catch(()=>{releaseState.textContent='Mở trang phát hành để xem gói Mac hiện có.';});
  void fetch('https://api.github.com/repos/mktminhqpbga-glitch/App-MooZ-Workflow/releases/latest').then(response=>{if(!response.ok)throw Error('Chưa có release');return response.json();}).then(release=>{const asset=release.assets?.find(asset=>asset.name==='MooZ-CVN-macOS-Intel.zip');if(asset&&asset.browser_download_url.startsWith('https://github.com/')){mac.href=asset.browser_download_url;mac.textContent='Tải macOS Intel · '+release.tag_name;releaseState.textContent='Bản phát hành: '+release.tag_name;}}).catch(()=>{});

  const cleanupRelay = mountRelaySettings(host, {onChanged: () => { code.value="";code.hidden=true;return refresh(); }});
  const panel = el("section", undefined, "settings-panel"),
    status = el("p", "Đang kiểm tra máy chủ…"),
    code = el("textarea");
  code.readOnly = true;
  code.hidden = true;
  code.setAttribute("aria-label", "Mã ghép Chrome");
  const access = el("input");
  access.type = "password";
  access.placeholder = "Mã truy cập máy chủ (nếu có)";
  access.setAttribute("aria-label", "Mã truy cập máy chủ");
  const cards = el("div");
  panel.append(
    el("h2", "Máy chủ và Chrome"),
    status,
    access,
    button("Lưu mã truy cập phiên này", () => {
      sessionStorage.setItem("mooz-server-access", access.value);
      access.value = "";
      return refresh();
    }),
    button("Kiểm tra kết nối", refresh),
    button("Tạo mã ghép Chrome", async () => {
      const pair = await api("chrome/pair", {});
      code.value = pair.uri;
      code.hidden = false;
      notice(pair.note || "Mã ghép có hạn. Dán vào MooZ Connect.");
    }),
    code,
    button("Sao chép mã", async () => {
      if (!code.value) throw Error("Tạo mã ghép trước.");
      await navigator.clipboard.writeText(code.value);
      notice("Đã sao chép mã ghép");
    }),
    button("Ngắt kết nối", async () => {
      if (confirm("Ngắt phiên Chrome? Lượt đang gửi cần được đối chiếu.")) {
        await api("chrome/disconnect", {});
        code.value = "";
        code.hidden = true;
        await refresh();
      }
    }),
  );
  const link = el("a", "Tải MooZ Connect 1.9.2", "back");
  link.href = "/downloads/MooZ-Connect.zip";
  panel.append(
    link,
    el(
      "p",
      "Cài tiện ích bằng Load unpacked, dán mã ghép, mở tab AI và đăng nhập. Kết nối local chỉ dùng khi Chrome và máy chủ Node chạy cùng máy; máy chủ cloud cần relay WSS.",
      "intro",
    ),
    el("h2", "AI qua API"),
    cards,
  );
  const provider = el("select"),
    tab = el("select");
  provider.setAttribute("aria-label", "AI cần kiểm tra");
  tab.setAttribute("aria-label", "Tab cần kiểm tra");
  for (const p of providerList.filter(
    (p) => !isAPIProvider(p.id),
  ))
    provider.add(new Option(p.name, p.id));
  async function refreshTabs() {
    tab.replaceChildren(new Option("Chọn tab…", ""));
    for (const t of await api("tabs?provider=" + provider.value)) {
      const o = new Option(t.title || t.url, t.id);
      o.dataset.url = t.url;
      tab.add(o);
    }
  }
  provider.onchange = () => void refreshTabs().catch((e) => notice(e.message));
  panel.append(
    el("h2", "Kiểm tra tab AI"),
    provider,
    tab,
    button("Cập nhật tab", refreshTabs),
    button("Kiểm tra và tiếp tục", async () => {
      if (!tab.value) throw Error("Chọn tab trước.");
      await api("chrome/resume", {
        provider: provider.value,
        tabId: Number(tab.value),
        chatURL: tab.selectedOptions[0]?.dataset.url,
      });
      notice("Tab đã sẵn sàng. Không tự gửi lại các lượt cũ.");
    }),
  );
  host.append(panel);
  async function refresh() {
    try {
      const s = await api("status");
      if (!host.isConnected) return;
      status.textContent = s.chrome.connected
        ? "Chrome đã ghép · " + (s.chrome.mode || "local")
        : "Chrome chưa ghép" +
          (s.chrome.remoteConfigured
            ? " · Relay đã cấu hình"
            : " · Chưa cấu hình relay từ xa");
      cards.replaceChildren();
      for (const p of s.providers)
        cards.append(
          el(
            "p",
            p.name +
              " · " +
              (p.ready ? "Có khóa trên máy chủ" : "Chưa cấu hình khóa"),
          ),
        );
      const available = readyOperations(s);
      cards.append(el("h2", "Khả năng công cụ ảnh"));
      for (const [operation, label] of Object.entries(advancedImageOperations))
        cards.append(
          el(
            "p",
            label +
              " · " +
              (available.has(operation)
                ? "Kết nối đã khai báo hỗ trợ"
                : "Chưa có kết nối hỗ trợ — ẩn trên canvas"),
          ),
        );
      const sidebar = document.querySelector(".connection small");
      if (sidebar)
        sidebar.textContent = s.chrome.connected
          ? "Chrome đã ghép"
          : "Chưa ghép Chrome";
    } catch (e) {
      status.textContent = e.message;
    }
  }
  await refresh();
  return () => {
    cleanupRelay();
    cleanupAPI();
    cleanupCustom();
    cleanupMaintenance();
    code.value = "";
  };
}
const labels = {
  queued: "Chờ lượt",
  preparing: "Chuẩn bị",
  sent: "Đã gửi · chờ AI",
  receiving: "Nhận kết quả",
  success: "Hoàn tất",
  error: "Chưa hoàn tất",
  unknown: "Cần đối chiếu",
  stopped: "Đã dừng",
  review: "Đã đối chiếu · chưa chạy tiếp",
};
export async function mountBatch(host, kind) {
  let alive = true, flowMode = "normal";
  const abort = new AbortController();
  host.replaceChildren(
    el("h1", kind === "image" ? "Tạo ảnh hàng loạt" : "Tạo video hàng loạt"),
    el(
      "p",
      "Mỗi tác vụ giữ riêng prompt, đầu vào và một AI/tab qua toàn bộ luồng.",
      "intro",
    ),
  );
  host.classList.add("batch-page");
  document.body.classList.add("batch-route");
  const workspace = el("div", undefined, "batch-workspace"),
    queuePanel = el("section", undefined, "batch-queue settings-panel"),
    queueStats = el("p", undefined, "batch-queue-stats"),
    history = el("section", undefined, "queue-list");
  const groupHeader = el("header", undefined, "batch-group-header"),
    connectionStatus = el("span"), groups = el("nav", undefined, "batch-groups");
  groups.setAttribute("aria-label", "Nhóm công cụ hàng loạt");
  const aiSettings = el("a", "Tab AI"); aiSettings.href = "#settings";
  groupHeader.append(icon("connections"), connectionStatus, aiSettings);
  const updateConnectionStatus = (running = null) => {
    const ready = new Set([...workspace.querySelectorAll('[aria-label="Tab hàng loạt"] option')].filter(option => option.value && option.value !== 'auto').map(option => option.value));
    if (running !== null) connectionStatus.dataset.running = running;
    connectionStatus.textContent = `${ready.size ? ready.size + " tab AI sẵn sàng" : "Chưa có tab AI sẵn sàng"} · ${connectionStatus.dataset.running || 0} đang xử lý · 1 luồng làm việc`;
  };
  updateConnectionStatus();
  for (const [label, glyph, action] of [
    ["Văn bản", "text", () => { flowMode="normal";workspace.classList.add("batch-text-mode"); for (const form of workspace.querySelectorAll('form')) form.querySelector('.batch-image-picker > button[aria-label="Bỏ ảnh đầu vào"]')?.click(); }],
    ["Ảnh sản phẩm", "image", () => { flowMode="normal"; workspace.classList.remove("batch-text-mode"); workspace.classList.remove("batch-extension-mode"); }],
    ["Đầu → Cuối", "frame", kind==="video"?()=>{flowMode="firstLast";workspace.classList.remove("batch-text-mode","batch-extension-mode");workspace.classList.add("batch-first-last-mode");}:null],
    ["Nối dài", "video", kind === "video" ? () => { flowMode="extend"; workspace.classList.add("batch-extension-mode"); } : null],
    ["Luồng đã lưu", "folder", () => openFlowLibrary({kind,onSelect:selectFlow,onChanged:updateFlow})],
    ["Luồng xử lý", "sliders", () => openFlowEditor({kind,template:templates.find(t=>t.id===workspace.querySelector('[aria-label="Luồng mẫu"]')?.value),onSaved:async item=>{await updateFlow(item);selectFlow(item);}})],
    ["Kho media", "folder", () => { workspace.classList.remove("batch-text-mode"); workspace.querySelector('[aria-label="Chọn ảnh đầu vào"]')?.click(); }],
  ]) {
    const control = button("", () => {
      action?.();
      workspace.classList.toggle("batch-first-last-mode",flowMode==="firstLast");for(const select of workspace.querySelectorAll('[aria-label="AI hàng loạt"]')){for(const option of select.options)option.disabled=flowMode==="firstLast"&&option.value&&!['google','fal'].includes(option.value);if(select.selectedOptions[0]?.disabled){select.value="";select.dispatchEvent(new Event("change"));}}
      for (const item of groups.children) item.setAttribute("aria-pressed", String(item === control));
    });
    control.append(icon(glyph), el("span", label));
    control.setAttribute("aria-pressed", String(label === "Ảnh sản phẩm"));
    if (!action) { control.disabled = true; control.title = "Chưa kết nối chế độ video này với dịch vụ AI."; }
    groups.append(control);
  }
  queuePanel.setAttribute("aria-label", "Tiến trình hàng đợi");
  queuePanel.append(el("h2", "Tiến trình hàng đợi"), queueStats, history);
  const assets = (await Promise.all([list("inputs"), list("results")])).flat().filter(a => a.kind === "image"),
    templates = await list("templates");
  const assetURLs = new Map(assets.map(asset => [asset.id, URL.createObjectURL(asset.blob)]));
  async function updateFlow(item){const index=templates.findIndex(t=>t.id===item.id);if(index>=0)templates.splice(index,1);if(!item.deleted)templates.push(item);for(const select of workspace.querySelectorAll('[aria-label="Luồng mẫu"]')){const old=select.value;select.replaceChildren(new Option('Luồng một bước',''));for(const t of templates)select.add(new Option(t.name,t.id));select.value=templates.some(t=>t.id===old)?old:'';}}
  function selectFlow(item){const select=workspace.querySelector('[aria-label="Luồng mẫu"]');if(select){select.value=item.id;select.dispatchEvent(new Event('change'));if(item.recipe){const form=select.closest('form');for(const[label,value]of [['Số cảnh',item.recipe.scenes],['Tỷ lệ khung',item.recipe.size],['Thời lượng video',item.recipe.duration??''],['AI hàng loạt',item.recipe.provider]]){const input=form.querySelector('[aria-label="'+label+'"]');if(input&&[...input.options].some(o=>o.value===String(value))){input.value=value;input.dispatchEvent(new Event('change'));}}}notice('Đã chọn luồng '+item.name+'. Xếp tác vụ để chốt đầu vào; chưa gửi AI.');}}
  let availableProviders = await connectedAI(kind).catch(() => []);
  const queueControls = el('div', undefined, 'batch-queue-controls'), concurrency = el('select'), queueState = el('small');
  concurrency.setAttribute('aria-label', 'Số tác vụ song song');
  for (let count=1; count<=6; count++) concurrency.add(new Option(count + ' tác vụ song song', count));
  queueControls.append(concurrency, button('Chạy hàng đợi', async () => { await queueRunner.start(Number(concurrency.value)); await render(); }), button('Tạm dừng cấp việc', () => { queueRunner.pause(); void render(); }), queueState);
  queuePanel.insertBefore(queueControls, history);
  let queueUnsubscribe = () => {};

  host.append(groupHeader, groups, workspace);
  async function createLane(lane) {
    const form = el("form", undefined, "batch-form settings-panel"),
      prompts = el("textarea");
    form.setAttribute("aria-label", "Luồng làm việc");
    prompts.placeholder = "[Yêu cầu thứ nhất, có thể nhiều dòng…]\n[Yêu cầu thứ hai với @tag ảnh…]";
    prompts.setAttribute("aria-label", "Prompt hàng loạt");
    prompts.required = true;
    prompts.maxLength = 1000000;
    const provider = el("select"),
      tabs = el("select"),
      ratio = el("select"),
      template = el("select"),
      source = el("select");
    provider.setAttribute("aria-label", "AI hàng loạt");
    tabs.setAttribute("aria-label", "Tab hàng loạt");
    source.setAttribute("aria-label", "Ảnh đầu vào");
    source.add(new Option("Không có ảnh đầu vào", ""));
    for (const a of assets)
      source.add(new Option(a.name, a.id));
    source.hidden = true;
    const imagePicker = el("div", undefined, "batch-image-picker"),
      imageChoices = el("div", undefined, "batch-image-choices"),
      chooseImage = button("Chọn ảnh đầu vào", () => {
        imageChoices.hidden = !imageChoices.hidden;
        chooseImage.setAttribute("aria-expanded", String(!imageChoices.hidden));
      }),
      clearImage = button("Bỏ chọn", () => selectImage(null));
    chooseImage.setAttribute("aria-label", "Chọn ảnh đầu vào");
    chooseImage.setAttribute("aria-expanded", "false");
    clearImage.setAttribute("aria-label", "Bỏ ảnh đầu vào");
    clearImage.hidden = true; imageChoices.hidden = true;
    imageChoices.setAttribute("role", "group"); imageChoices.setAttribute("aria-label", "Ảnh trong Kho");
    function selectImage(asset) {
      source.value = asset?.id || "";
      chooseImage.replaceChildren();
      if (asset) { const preview = el("img"); preview.src = assetURLs.get(asset.id); preview.alt = asset.name; chooseImage.append(preview, el("span", "Đổi ảnh đầu vào")); }
      else chooseImage.textContent = "Chọn ảnh đầu vào";
      clearImage.hidden = !asset; imageChoices.hidden = true; chooseImage.setAttribute("aria-expanded", "false");
      for (const card of imageChoices.children) card.setAttribute("aria-pressed", String(card.dataset.assetId === source.value));
    }
    for (const asset of assets) {
      const card = button("", () => selectImage(asset)), preview = el("img");
      preview.src = assetURLs.get(asset.id); preview.alt = asset.name; preview.loading = "lazy";
      card.append(preview); card.title = asset.name; card.dataset.assetId = asset.id;
      card.setAttribute("aria-label", "Chọn ảnh " + asset.name); card.setAttribute("aria-pressed", "false");
      imageChoices.append(card);
    }
    if (!assets.length) imageChoices.append(el("p", "Kho chưa có ảnh. Tải ảnh lên Kho để chọn."));
    imagePicker.append(chooseImage, clearImage, imageChoices);
    const characterIds = new Set(), characterPicker = el('div', undefined, 'batch-character-picker'), characterChoices = el('div', undefined, 'batch-image-choices'), characterPreview = el('div', undefined, 'batch-character-preview');
    characterChoices.hidden = true; characterChoices.setAttribute('aria-label', 'Kho ảnh nhân vật');
    const characterToggle = button('Chọn ảnh nhân vật (tùy chọn)', () => { characterChoices.hidden = !characterChoices.hidden; });
    characterToggle.setAttribute('aria-label', 'Chọn ảnh nhân vật tham chiếu');
    for (const asset of assets) {
      const choice = button('', () => {
        validateImage(asset);
        if (characterIds.has(asset.id)) characterIds.delete(asset.id); else characterIds.add(asset.id);
        choice.setAttribute('aria-pressed', String(characterIds.has(asset.id)));
        characterPreview.replaceChildren();
        for (const id of characterIds) { const img = el('img'); img.src = assetURLs.get(id); img.alt = assets.find(item => item.id === id)?.name || 'Nhân vật'; characterPreview.append(img); }
      }), preview = el('img'); preview.src = assetURLs.get(asset.id); preview.alt = asset.name;
      choice.append(preview); choice.setAttribute('aria-label', 'Nhân vật ' + asset.name); choice.setAttribute('aria-pressed','false'); characterChoices.append(choice);
    }
    characterPicker.append(characterToggle, characterPreview, characterChoices);
    const splitMode = el('select'), negative = el('textarea'), sceneCount = el('select'), makeImages = el('input');
    splitMode.setAttribute('aria-label','Cách tách prompt');
    for (const [value,label] of [['blocks','Khối [ ... ] · nhiều dòng'],['lines','Mỗi dòng một yêu cầu'],['paragraphs','Mỗi đoạn cách dòng trống'],['whole','Gộp toàn văn thành một yêu cầu']]) splitMode.add(new Option(label,value));
    negative.placeholder = 'Negative prompt chung (tùy chọn)…'; negative.maxLength = 20000; negative.setAttribute('aria-label','Negative prompt chung'); negative.className = 'batch-negative';
    sceneCount.setAttribute('aria-label','Số cảnh'); for (let count=1; count<=12; count++) sceneCount.add(new Option(count + ' cảnh',count));
    makeImages.type = 'checkbox'; makeImages.setAttribute('aria-label','Tạo ảnh trước video');

    const tagManager=el('details',undefined,'batch-tag-manager'), tagTitle=el('summary','Kho ảnh & @tag · đổi tag / tải ảnh'), tagRows=el('div'), uploadImages=el('input');
    uploadImages.type='file';uploadImages.accept='image/png,image/jpeg,image/webp';uploadImages.multiple=true;uploadImages.setAttribute('aria-label','Tải ảnh tham chiếu vào Kho');
    tagManager.append(tagTitle,el('p','PNG/JPG/WebP ≤8 MB/ảnh; tối đa 8 ảnh/job, 32 MB snapshot. Ảnh nhân vật là tùy chọn.'),uploadImages,tagRows);
    function renderTagRows(){
      tagRows.replaceChildren();const tags=uniqueTags(assets);
      for(const asset of assets){const row=el('label'),image=el('img'),input=el('input');image.src=assetURLs.get(asset.id);image.alt=asset.name;input.value=tags.get(asset.id);input.setAttribute('aria-label','Tag ảnh '+asset.name);
        input.onchange=async()=>{const previous=asset.batchTag;const next=input.value.replace(/^@/,'').trim().toLowerCase();try{if(!/^[a-z0-9_-]{1,48}$/.test(next))throw Error('Tag cần 1–48 chữ thường, số, - hoặc _.');if([...uniqueTags(assets)].some(([id,tag])=>id!==asset.id&&tag===next))throw Error('Tag đã tồn tại.');asset.batchTag=next;await write(asset.source==='upload'?'inputs':'results',asset);notice('Đã đổi @'+next+'; job đã chốt vẫn giữ ảnh cũ.');}catch(error){asset.batchTag=previous;notice(error.message);input.value=tags.get(asset.id);}};
        row.append(image,el('span','@'),input);tagRows.append(row);
      }
    }
    uploadImages.onchange=async()=>{try{
      const files=[...uploadImages.files];for(const file of files)validateImage({id:'upload',blob:file});
      if(files.reduce((sum,file)=>sum+file.size,0)+assets.filter(asset=>asset.batchTag).reduce((sum,asset)=>sum+asset.blob.size,0)>limits.snapshotBytes)throw Error('Kho tham chiếu vượt 32 MB.');
      for(const file of files){const bitmap=await createImageBitmap(file);bitmap.close();}
      for(const file of files){const asset=await addAsset(file);assets.push(asset);asset.batchTag=uniqueTags(assets).get(asset.id);await write('inputs',asset);assetURLs.set(asset.id,URL.createObjectURL(asset.blob));
        const product=button('',()=>selectImage(asset)),image=el('img');image.src=assetURLs.get(asset.id);image.alt=asset.name;product.dataset.assetId=asset.id;product.setAttribute('aria-label','Chọn ảnh '+asset.name);product.append(image);imageChoices.append(product);
        const person=button('',()=>{if(characterIds.has(asset.id))characterIds.delete(asset.id);else characterIds.add(asset.id);person.setAttribute('aria-pressed',String(characterIds.has(asset.id)));characterPreview.replaceChildren();for(const id of characterIds){const img=el('img');img.src=assetURLs.get(id);img.alt=assets.find(item=>item.id===id)?.name||'Nhân vật';characterPreview.append(img);}}),portrait=el('img');portrait.src=assetURLs.get(asset.id);portrait.alt=asset.name;person.append(portrait);person.setAttribute('aria-label','Nhân vật '+asset.name);characterChoices.append(person);
      }renderTagRows();uploadImages.value='';
    }catch(error){notice(error.message);}};
    renderTagRows();
    template.add(new Option("Luồng một bước", ""));
    template.setAttribute("aria-label", "Luồng mẫu");
    for (const t of templates) template.add(new Option(t.name, t.id));
    provider.add(new Option(availableProviders.length ? "Chọn AI…" : "Chưa có AI kết nối", ""));
    for (const p of availableProviders)
      provider.add(new Option(p.name, p.id));
    for (const r of ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"]) ratio.add(new Option(r, r));
    ratio.value = "16:9"; ratio.hidden = true;
    ratio.setAttribute("aria-label", "Tỷ lệ khung");
    const endFrame=el('select'),firstLast=el('section',undefined,'batch-first-last-field'),endChoices=el('div',undefined,'batch-image-choices');endFrame.hidden=true;endFrame.setAttribute('aria-label','Ảnh khung cuối');endFrame.add(new Option('Chọn ảnh khung cuối…',''));for(const a of assets){endFrame.add(new Option(a.name,a.id));const choice=button('',()=>{endFrame.value=a.id;for(const item of endChoices.children)item.setAttribute('aria-pressed',String(item===choice));}),image=el('img');image.src=assetURLs.get(a.id);image.alt=a.name;choice.setAttribute('aria-label','Khung cuối '+a.name);choice.append(image);endChoices.append(choice);}firstLast.append(el('h3','Đầu → Cuối'),el('p','Chọn khung đầu ở Ảnh sản phẩm; chọn khung cuối dưới đây. Cần Veo API hoặc fal đã kết nối. Google Veo cần 8 giây, 16:9/9:16.'),endFrame,endChoices);form.append(firstLast);
    const extensionField=el('section',undefined,'batch-extension-field'), extensionVideo=el('select'),targetDuration=el('input');extensionVideo.setAttribute('aria-label','Video cần nối dài');targetDuration.type='number';targetDuration.value=30;targetDuration.min=.1;targetDuration.step=.1;targetDuration.setAttribute('aria-label','Thời lượng mục tiêu');
    extensionVideo.add(new Option('Chọn video nguồn…',''));for(const asset of await listAssets())if(asset.kind==='video')extensionVideo.add(new Option(asset.name,asset.id));
    extensionField.append(el('label','Video nguồn'),extensionVideo,el('label','Thời lượng mục tiêu (giây)'),targetDuration,el('p','Dùng frame cuối thật làm ảnh tham chiếu cho đoạn tiếp theo, rồi ghép. Nếu clip AI trả về quá ngắn, dừng và giữ các đoạn đã lưu.'));
    const generation = { quality: "medium", resolution: kind === "video" ? "720P" : "1K", background: "auto", count: 1 },
      generationMenu = el("details", undefined, "batch-generation-settings"),
      generationSummary = el("summary"), generationPanel = el("div", undefined, "generation-options-panel"),
      qualityLabels = { low: "Thấp", medium: "Tiêu chuẩn", high: "Cao", ultra: "Siêu cao", max: "Tối đa" };
    generationSummary.setAttribute("aria-label", "Thông số hàng loạt");
    generationSummary.addEventListener("click", event => { if (event.detail > 1) event.preventDefault(); });
    const updateGenerationSummary = () => { generationSummary.textContent = `${ratio.value} · ${qualityLabels[generation.quality]} · ${generation.resolution}${kind === "image" ? " · " + generation.count + " ảnh" : ""} ⌄`; };
    const generationHeading = el("header", undefined, "resource-panel-heading"), generationClose = button("Đóng", () => { generationMenu.open = false; });
    generationClose.prepend(icon("close")); generationClose.setAttribute("aria-label", "Đóng thông số hàng loạt");
    generationHeading.append(el("h2", "Thông số"), generationClose); generationPanel.append(generationHeading);
    function generationChoices(title, options, value, onChange, ratios = false) {
      const section = el("section", undefined, "generation-option-section"), group = el("div", undefined, ratios ? "ratio-grid" : "generation-option-choices");
      group.setAttribute("role", "group"); group.setAttribute("aria-label", title); section.append(el("h3", title), group);
      for (const [id, label] of options) {
        const tile = button(label, () => {
          onChange(id);
          for (const item of group.children) item.setAttribute("aria-pressed", String(item === tile));
          updateGenerationSummary();
        });
        tile.dataset.value=id;tile.setAttribute("aria-pressed", String(String(id) === String(value)));
        if (ratios) {
          tile.setAttribute("aria-label", "Khung " + label);
          const shape = el("span", undefined, "ratio-shape"), [width, height] = id.split(":").map(Number);
          shape.style.width = 24 * Math.min(1, width / height) + "px"; shape.style.height = 24 * Math.min(1, height / width) + "px";
          tile.replaceChildren(shape, el("span", label));
        }
        group.append(tile);
      }
      generationPanel.append(section);
    }
    generationChoices("Chất lượng", Object.entries(qualityLabels), generation.quality, value => { generation.quality = value; });
    generationChoices("Độ phân giải", (kind === "video" ? ["480P", "720P", "1080P"] : ["1K", "2K", "4K"]).map(value => [value, value]), generation.resolution, value => { generation.resolution = value; });
    if (kind === "image") generationChoices("Nền ảnh", [["auto", "Tự động"], ["preserve", "Giữ nền"], ["transparent", "Trong suốt"]], generation.background, value => { generation.background = value; });
    generationChoices("Tỷ lệ khung", [...ratio.options].map(option => [option.value, option.value]), ratio.value, value => { ratio.value = value; }, true);
    if (kind === "image") generationChoices("Số lượng ảnh", [1, 2, 4].map(value => [value, value + " ảnh"]), 1, value => { generation.count = value; });
    generationPanel.append(el("small", "Các thông số là yêu cầu đầu ra; kết quả phụ thuộc model đang kết nối."));
    generationMenu.append(generationSummary, generationPanel); updateGenerationSummary();
    generationMenu.ontoggle = () => {
      if (!generationMenu.open) return;
      for (const menu of workspace.querySelectorAll('.batch-generation-settings[open]')) if (menu !== generationMenu) menu.open = false;
      const anchor = generationSummary.getBoundingClientRect();
      generationPanel.style.maxHeight = Math.max(80, anchor.top - 24) + "px";
    };
    document.addEventListener("pointerdown", event => {
      if (generationMenu.open && !generationMenu.contains(event.target)) generationMenu.open = false;
    }, { capture: true, signal: abort.signal });
    const duration = el("select");
    duration.setAttribute("aria-label", "Thời lượng video");
    duration.add(new Option("Không chọn thời lượng", ""));
    for (const d of [4, 5, 6, 8, 10, 15, 30, 40]) duration.add(new Option(d + " giây", d));
    duration.hidden = kind !== "video";
    let refreshRevision = 0, tabProvider = "";
    async function refresh() {
      const revision = ++refreshRevision, selectedProvider = provider.value;
      const previousTab = selectedProvider === tabProvider ? tabs.value : "";
      tabProvider = selectedProvider;
      tabs.replaceChildren(new Option("Đang tải tab…", ""));
      tabs.disabled = true;
      if (!selectedProvider) { tabs.replaceChildren(new Option("Chọn AI trước", "")); return; }
      if (isAPIProvider(selectedProvider)) {
        tabs.replaceChildren(new Option("Kết nối API · không cần tab", ""));
        updateConnectionStatus();
        return;
      }
      try {
        const found = await api("tabs?provider=" + selectedProvider);
        if (!alive || revision !== refreshRevision) return;
        tabs.replaceChildren(new Option(found.length ? "Chọn tab chạy tác vụ…" : "Chưa có tab kết nối", ""));
        if (found.length) tabs.add(new Option("Tự chọn tab phù hợp khi bắt đầu", "auto"));
        for (const t of found) {
          const o = new Option(t.title || t.url, t.id);
          o.dataset.url = t.url;
          tabs.add(o);
        }
        if (found.some(tab => String(tab.id) === previousTab)) tabs.value = previousTab;
      } catch (e) {
        if (revision !== refreshRevision) return;
        tabs.replaceChildren(new Option("Chưa tải được tab", ""));
        notice(e.message);
      } finally { if (revision === refreshRevision && alive) { tabs.disabled = false; updateConnectionStatus(); } }
    }
    function applyGenerationCaps(){const caps=generationCapabilities(provider.value,kind);for(const option of ratio.options)option.disabled=!!caps&&!caps.ratios.includes(option.value);if(ratio.selectedOptions[0]?.disabled)ratio.value=caps.ratios[0];for(const[key,allowed]of [['quality',caps?.qualities],['resolution',caps?.resolutions],['background',caps?.backgrounds]])if(allowed&&!allowed.includes(generation[key]))generation[key]=allowed[0];for(const option of duration.options)option.disabled=!!caps?.durations&&option.value!==''&&!caps.durations.includes(Number(option.value));if(duration.selectedOptions[0]?.disabled)duration.value=String(caps.durations[0]);const groups={'Chất lượng':['quality',caps?.qualities],'Độ phân giải':['resolution',caps?.resolutions],'Nền ảnh':['background',caps?.backgrounds],'Tỷ lệ khung':['size',caps?.ratios]};for(const group of generationPanel.querySelectorAll('[role=group]')){const entry=groups[group.getAttribute('aria-label')];if(!entry)continue;for(const tile of group.children){tile.disabled=!!entry[1]&&!entry[1].includes(tile.dataset.value);tile.setAttribute('aria-pressed',String(tile.dataset.value===(entry[0]==='size'?ratio.value:String(generation[entry[0]]))));}}generationPanel.querySelector('small').textContent=caps?.note||'Các thông số là yêu cầu đầu ra; giới hạn thực phụ thuộc model trên tab AI.';updateGenerationSummary();}
    provider.onchange = () => {applyGenerationCaps();void refresh();};
    const submit = el("button", "Thêm & tạo node");
    submit.type = "submit";
    const refreshTabButton = button("↻", async () => {
        const selected = provider.value;
        availableProviders = await connectedAI(kind, { force: true });
        provider.replaceChildren(new Option(availableProviders.length ? 'Chọn AI…' : 'Chưa có AI kết nối',''));
        for (const item of availableProviders) provider.add(new Option(item.name,item.id));
        provider.value = availableProviders.some(item=>item.id===selected) ? selected : '';
        await refresh();
      });
    refreshTabButton.setAttribute("aria-label", "Cập nhật tab"); refreshTabButton.title="Cập nhật tab";
    form.append(
      el("h2", "Luồng làm việc"),
      prompts,
      source,
      template,
      provider,
      tabs,
      ratio,
      duration,
      splitMode,
      sceneCount,
      makeImages,
      characterPicker,
      extensionField,
      tagManager,
      negative,
      submit,
    );
    const promptCount = el("small", "0 yêu cầu", "batch-prompt-count");
    const updatePromptCount = () => {
      try { const count = splitPrompts(prompts.value, splitMode.value).length; promptCount.textContent = count + ' prompt × ' + (kind === 'image' ? generation.count : 1) + ' = ' + count * (kind === 'image' ? generation.count : 1) + ' job · chưa gửi AI'; }
      catch (error) { promptCount.textContent = prompts.value.trim() ? error.message : '0 yêu cầu'; }
    };
    prompts.addEventListener('input',updatePromptCount); splitMode.onchange = updatePromptCount;
    form.insertBefore(promptCount, source);
    for (const [control, label] of [[source, "Ảnh sản phẩm (tùy chọn)"], [template, "Luồng mẫu"], [provider, "AI thực hiện"], [tabs, "Tab chạy tác vụ"], [ratio, "Thông số đầu ra"], [duration, "Thời lượng mỗi cảnh"], [splitMode,"Cách tách yêu cầu"], [sceneCount,"Kịch bản nhiều cảnh"], [makeImages,"Tạo ảnh trước khi tạo video"]]) {
      const field = el("label", undefined, "batch-field");
      control.before(field); field.append(el("span", label), control);
      if (control === source) field.append(imagePicker);
      if (control === ratio) field.append(generationMenu);
      if (control === source) field.classList.add("batch-source-field");
      field.hidden = [duration, sceneCount, makeImages].includes(control) && kind !== "video";
    }
    const connectionRow = el('div', undefined, 'batch-connection-row');
    connectionRow.setAttribute('aria-label','Ảnh, luồng mẫu, AI và tab');
    promptCount.after(connectionRow);
    for (const control of [source,template,provider,tabs]) connectionRow.append(control.closest('.batch-field'));
    connectionRow.after(firstLast);
    const tabControls=el('div',undefined,'batch-tab-controls');tabs.before(tabControls);tabControls.append(tabs,refreshTabButton);
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      const selected = { modeType:flowMode, lastFrame:endFrame.value, extensionVideo:extensionVideo.value, targetDuration:Number(targetDuration.value), text: prompts.value, mode: splitMode.value, copies: kind === 'image' ? generation.count : 1, assets: [...assets], sourceId: source.value, characterIds: flowMode==='firstLast'?[endFrame.value].filter(Boolean):[...characterIds], provider: provider.value, tabId: tabs.value && tabs.value !== 'auto' ? Number(tabs.value) : null, autoTab: tabs.value === 'auto', chatURL: tabs.selectedOptions[0]?.dataset.url || null, kind, ratio: ratio.value, duration: duration.value === '' ? null : Number(duration.value), generation: { ...generation }, scenes: Number(sceneCount.value), createImages: makeImages.checked, negative: negative.value, template: template.value };
      try {
        if(selected.modeType==='firstLast'){if(!['google','fal'].includes(selected.provider))throw Error('Đầu → Cuối cần Google Veo API hoặc fal.');if(!selected.sourceId||!selected.lastFrame||selected.sourceId===selected.lastFrame)throw Error('Chọn hai ảnh đầu và cuối khác nhau.');if(characterIds.size)throw Error('Bỏ chọn ảnh nhân vật bổ sung khi dùng hai khung đầu/cuối.');}
        if (!selected.provider) throw Error('Chọn AI đang kết nối trước khi chuẩn bị.');
        if (!isAPIProvider(selected.provider) && !tabs.value) throw Error('Chọn tab đang kết nối trước khi xếp tác vụ.');
        const selectedTemplate=selected.template?templates.find(item=>item.id===selected.template):null;
        const templateGraph = selectedTemplate?.graph || null;
        if (selected.template && !templateGraph) throw Error('Không tìm thấy luồng mẫu.');
        const jobs = await prepareJobs({ ...selected, graph: async plan => {
          if(selected.modeType==='firstLast')return buildFirstLast({first:selected.sourceId,last:selected.lastFrame,prompt:plan.prompt,references:plan.references,size:selected.ratio,duration:selected.duration??8,...selected.generation});
          if(selected.modeType==='extend'){
            const source=await readAsset(selected.extensionVideo);if(!source||source.kind!=='video')throw Error('Chọn video thật để nối dài.');
            const video=document.createElement('video'),url=URL.createObjectURL(source.blob);let measured;
            try{measured=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Không đọc được thời lượng video nguồn.')),15000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve(video.duration);};video.onerror=()=>{clearTimeout(timer);reject(Error('Video nguồn không giải mã được.'));};video.src=url;});}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
            return buildContinuation({source,sourceDuration:measured,targetDuration:selected.targetDuration,duration:selected.duration,prompt:plan.prompt,references:plan.references,size:selected.ratio,...selected.generation,negative:selected.negative});
          }
          if(selectedTemplate?.recipe)return compileRecipe(selectedTemplate.recipe,{prompt:plan.prompt,references:plan.references,negative:selected.negative,generation:selected.generation,size:selected.ratio,duration:selected.duration});
          if (!templateGraph) return buildFlow({ kind, prompt: plan.prompt, references: plan.references, scenes: selected.scenes, createImages: selected.createImages, negative: selected.negative, size: selected.ratio, duration: selected.duration, ...selected.generation });
          const graph = structuredClone(templateGraph), first = graph.nodes.find(node => node.type.startsWith('generate'));
          if (!first) throw Error('Mẫu chưa có bước AI.');
          first.data.studioPrompt = plan.prompt;
          for (const node of graph.nodes) { delete node.data.assetId; delete node.data.resultAssets; if (node.type.startsWith('generate')) Object.assign(node.data, { size: selected.ratio, duration: selected.duration, negativePrompt: selected.negative, ...selected.generation }); }
          // Restore real input IDs of the template; only generated outputs were cleared above.
          for (const node of graph.nodes.filter(node => ['imageInput','videoInput','audioInput'].includes(node.type))) node.data.assetId = templateGraph.nodes.find(old => old.id === node.id).data.assetId;
          for (const reference of plan.references) {
            const source = { id: crypto.randomUUID(), type: 'imageInput', x: 0, y: graph.nodes.length * 220, data: { assetId: reference.id, customName: reference.name } }; graph.nodes.push(source);
            graph.edges.push({ id: crypto.randomUUID(), source: source.id, target: first.id, sourcePort: 'image', targetPort: 'reference' });
          }
          return graph;
        } });
        if (prompts.value === selected.text) prompts.value = '';
        updatePromptCount();
        notice('Đã chốt ' + jobs.length + ' job và node. Bấm Chạy hàng đợi để gửi AI.');
        queueKey = ''; await render();
      } catch (error) { notice(error.message); }
      finally { submit.disabled = false; }
    };
    workspace.append(form);
    void refresh();
  }
  await createLane(1);
  workspace.append(queuePanel);
  let queueRevision = 0, queueKey = "";
  async function render() {
    const revision = ++queueRevision;
    const jobs = (await list("jobs"))
      .filter((j) => (j.batchLane != null || j.projectId == null) && (j.kind === kind || !j.kind))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!alive || !history.isConnected || revision !== queueRevision) return;
    const nextKey = JSON.stringify([queueRunner.state().enabled, jobs.map(job => [job.id, job.status, job.updatedAt, job.outputs, job.error])]);
    if (queueKey === nextKey && history.children.length) return;
    const waiting = jobs.filter(j => j.status === "queued").length,
      running = jobs.filter(j => ["preparing", "sent", "receiving"].includes(j.status)).length,
      done = jobs.filter(j => j.status === "success").length;
    queueStats.textContent = `${waiting} chờ · ${running} đang chạy · ${done} hoàn tất · ${jobs.filter(j=>j.status==="error").length} lỗi · ${jobs.filter(j=>["unknown","review"].includes(j.status)).length} cần kiểm tra`;
    updateConnectionStatus(running);
    const rows = document.createDocumentFragment();
    for (const job of jobs) {
      const row = el("article", undefined, "queue-row");
      row.append(
        el("strong", job.title),
        el("span", labels[job.status] || job.status, "job-state " + job.status),
      );
      row.dataset.jobId = job.id;
      row.append(el('small','Task ID: '+job.id,'batch-task-id'));
      const snapshot=el('details',undefined,'batch-job-snapshot'), snapTitle=el('summary','Prompt và đầu vào đã chốt');
      snapshot.append(snapTitle,el('pre',job.originalPrompt || job.graph.nodes.find(node=>node.type.startsWith('generate'))?.data.studioPrompt || ''));
      const refs=el('div',undefined,'batch-snapshot-images');
      for (const [assetId,input] of Object.entries(job.inputAssets||{})) if(input.kind==='image'&&input.blob){if(!assetURLs.has('snapshot-'+job.id+'-'+assetId))assetURLs.set('snapshot-'+job.id+'-'+assetId,URL.createObjectURL(input.blob));const img=el('img');img.src=assetURLs.get('snapshot-'+job.id+'-'+assetId);img.alt=input.name;refs.append(img);}
      snapshot.append(refs);row.append(snapshot);
      if(job.status==='queued'){const until=Math.max(0,...jobs.filter(item=>item.provider===job.provider).map(item=>item.retryAt||0));row.append(el('small',until>Date.now()?'Provider tạm giữ theo Retry-After · '+Math.ceil((until-Date.now())/1000)+' giây':queueRunner.state().enabled?'Chờ đúng tab / slot provider':'Chờ bấm Chạy hàng đợi','batch-wait-reason'));}
      const resultGallery=el('div',undefined,'batch-result-gallery');
      const outputIds=[...new Set([job.resultId,...Object.entries(job.outputs||{}).filter(([id])=>!['imageInput','videoInput','audioInput'].includes(job.graph.nodes.find(node=>node.id===id)?.type)).map(([,value])=>value?.assetId)].filter(Boolean))];
      for(const assetId of outputIds){const asset=await readAsset(assetId);if(!asset?.blob)continue;if(!assetURLs.has(asset.id))assetURLs.set(asset.id,URL.createObjectURL(asset.blob));const item=el('div'),media=el(asset.kind==='image'?'img':asset.kind==='text'?'pre':asset.kind);if(asset.kind==='text')media.textContent=await asset.blob.text();else{media.src=assetURLs.get(asset.id);media.controls=asset.kind!=='image';media.alt=asset.name;}const download=el('a',assetId===job.resultId?'Tải thành phẩm':'Tải kết quả bước');download.href=assetURLs.get(asset.id);download.download=asset.name;item.append(media,download);resultGallery.append(item);}
      row.append(resultGallery);

      const processingNodes = job.graph.nodes.filter(n => !["imageInput","videoInput","audioInput","prompt","negativePrompt","preview"].includes(n.type)), total=processingNodes.length,
        completed = processingNodes.filter(n => job.outputs?.[n.id] && job.outputs[n.id].accepted !== false).length;
      row.append(el("small", `${job.batchLane ? "Luồng · " : ""}${providerList.find(p => p.id === job.provider)?.name || job.provider}${job.tabId ? " · Tab " + job.tabId : ""} · ${completed}/${total} bước`, "batch-job-meta"));
      const progress = el("progress");
      progress.max = total || 1; progress.value = completed;
      progress.setAttribute("aria-label", "Số bước hoàn tất");
      row.append(progress);
      if (job.error) row.append(el("p", job.error));
      const actions = el("div", undefined, "project-actions");
      if(job.projectId){const link=el('a','Mở Canvas');link.href='#canvas/'+job.projectId;actions.append(link);}
      if(['error','stopped','review'].includes(job.status))actions.append(button('Tiếp tục bước còn thiếu',async()=>{
        const output=job.outputs?.[job.activeNode];
        const corrected=output?.accepted===false?prompt('Sửa JSON kịch bản; không gửi lại bước đã chấp nhận',output.text):null;
        if(output?.accepted===false&&corrected===null)return;
        if(!confirm('Đã kiểm tra lượt cũ? Chỉ tiếp tục phần còn thiếu, giữ đúng tab và đầu vào đã chốt.'))return;
        await resumeJob(job.id,corrected);queueKey='';await render();
      }));

      if (job.status === "queued")
        actions.append(
          button("Chạy", async () => {
            await queueRunner.start(Number(concurrency.value));
            await render();
          }),
        );
      if (["queued", "preparing", "sent", "receiving"].includes(job.status))
        actions.append(
          button("Dừng", async () => {
            await stopJob(job.id);
            await render();
          }),
        );
      if (job.status === "unknown")
        actions.append(
          button("Kiểm tra kết quả", async () => {
            await inspectJob(job.id);
            await render();
          }),
        );
      if (!["preparing", "sent", "receiving"].includes(job.status))
        actions.append(
          button("Xóa lịch sử", async () => {
            if (
              confirm(
                "Xóa bản ghi tác vụ? Media trong Kho Kết quả vẫn được giữ.",
              )
            ) {
              await remove("jobs", job.id);
              await render();
            }
          }),
        );
      row.append(actions);
      rows.append(row);
    }
    if (!jobs.length) rows.append(el("p", "Chưa có tác vụ.", "intro"));
    if (!alive || revision !== queueRevision) return;
    history.replaceChildren(rows);
    queueKey = nextKey;
  }
  await recoverJobs();
  queueUnsubscribe = queueRunner.subscribe(state => {
    queueState.textContent = (state.enabled ? 'Đang cấp việc' : 'Tạm dừng · chưa cấp việc mới') + (state.owner ? ' · Trang quản lý' : '') + (state.error ? ' · ' + state.error : '');
    void render();
  });
  await render();
  const timer = setInterval(() => void render(), 3000);
  return () => {
    alive = false;
    abort.abort();
    host.classList.remove("batch-page");
    document.body.classList.remove("batch-route");
    queueUnsubscribe();
    for (const url of assetURLs.values()) URL.revokeObjectURL(url);
    clearInterval(timer);
  };
}
