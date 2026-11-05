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
} from "./core/storage.js";
import { ProjectRepository } from "./core/projects.js";
import {
  createJob,
  startJob,
  stopJob,
  inspectJob,
  recoverJobs,
} from "./core/runner.js";
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
    (p) => !["google", "openai"].includes(p.id),
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
  review: "Đã thu hồi kết quả",
};
export async function mountBatch(host, kind) {
  let alive = true;
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
    const ready = new Set([...workspace.querySelectorAll('[aria-label="Tab hàng loạt"] option')].filter(option => option.value).map(option => option.value));
    if (running !== null) connectionStatus.dataset.running = running;
    connectionStatus.textContent = `${ready.size ? ready.size + " tab AI sẵn sàng" : "Chưa có tab AI sẵn sàng"} · ${connectionStatus.dataset.running || 0} đang xử lý · 2 khu làm việc`;
  };
  updateConnectionStatus();
  for (const [label, glyph, action] of [
    ["Văn bản", "text", () => { workspace.classList.add("batch-text-mode"); for (const form of workspace.querySelectorAll('form')) form.querySelector('.batch-image-picker > button[aria-label="Bỏ ảnh đầu vào"]')?.click(); }],
    ["Ảnh sản phẩm", "image", () => workspace.classList.remove("batch-text-mode")],
    ["Đầu → Cuối", "frame", null],
    ["Nối dài", "video", null],
    ["Luồng đã lưu", "folder", () => { workspace.querySelector('[aria-label="Luồng mẫu"]')?.focus(); }],
    ["Luồng xử lý", "sliders", () => { queuePanel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }],
    ["Kho media", "folder", () => { workspace.classList.remove("batch-text-mode"); workspace.querySelector('[aria-label="Chọn ảnh đầu vào"]')?.click(); }],
  ]) {
    const control = button("", () => {
      action?.();
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
  const availableProviders = await connectedAI(kind).catch(() => []);
  host.append(groupHeader, groups, workspace);
  async function createLane(lane) {
    const form = el("form", undefined, "batch-form settings-panel"),
      prompts = el("textarea");
    form.setAttribute("aria-label", "Khu làm việc " + lane);
    prompts.placeholder = "Mỗi dòng là một yêu cầu riêng…";
    prompts.setAttribute("aria-label", "Prompt hàng loạt");
    prompts.required = true;
    prompts.maxLength = 50000;
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
    template.add(new Option("Luồng một bước", ""));
    template.setAttribute("aria-label", "Luồng mẫu");
    for (const t of templates) template.add(new Option(t.name, t.id));
    provider.add(new Option(availableProviders.length ? "Chọn AI…" : "Chưa có AI kết nối", ""));
    for (const p of availableProviders)
      provider.add(new Option(p.name, p.id));
    for (const r of ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"]) ratio.add(new Option(r, r));
    ratio.value = "16:9"; ratio.hidden = true;
    ratio.setAttribute("aria-label", "Tỷ lệ khung");
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
        tile.setAttribute("aria-pressed", String(String(id) === String(value)));
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
    for (const d of [5, 10, 15, 30, 40]) duration.add(new Option(d + " giây", d));
    duration.hidden = kind !== "video";
    let refreshRevision = 0, tabProvider = "";
    async function refresh() {
      const revision = ++refreshRevision, selectedProvider = provider.value;
      const previousTab = selectedProvider === tabProvider ? tabs.value : "";
      tabProvider = selectedProvider;
      tabs.replaceChildren(new Option("Đang tải tab…", ""));
      tabs.disabled = true;
      if (!selectedProvider) { tabs.replaceChildren(new Option("Chọn AI trước", "")); return; }
      if (["google", "openai"].includes(selectedProvider)) {
        tabs.replaceChildren(new Option("Kết nối API · không cần tab", ""));
        updateConnectionStatus();
        return;
      }
      try {
        const found = await api("tabs?provider=" + selectedProvider);
        if (!alive || revision !== refreshRevision) return;
        tabs.replaceChildren(new Option(found.length ? "Chọn tab chạy tác vụ…" : "Chưa có tab kết nối", ""));
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
    provider.onchange = () => void refresh();
    const submit = el("button", "Xếp tác vụ vào hàng đợi");
    submit.type = "submit";
    form.append(
      el("h2", "Khu làm việc " + lane),
      prompts,
      source,
      template,
      provider,
      tabs,
      button("Cập nhật tab", refresh),
      ratio,
      duration,
      submit,
    );
    const promptCount = el("small", "0 yêu cầu", "batch-prompt-count");
    prompts.addEventListener("input", () => {
      promptCount.textContent = prompts.value.split("\n").filter(line => line.trim()).length + " yêu cầu · tối đa 50";
    });
    form.insertBefore(promptCount, source);
    for (const [control, label] of [[source, "Ảnh đầu vào"], [template, "Luồng mẫu"], [provider, "AI thực hiện"], [tabs, "Tab chạy tác vụ"], [ratio, "Tỷ lệ khung"], [duration, "Thời lượng"]]) {
      const field = el("label", undefined, "batch-field");
      control.before(field); field.append(el("span", label), control);
      if (control === source) field.append(imagePicker);
      if (control === ratio) field.append(generationMenu);
      if (control === source) field.classList.add("batch-source-field");
      field.hidden = control === duration && kind !== "video";
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      const created = [], originalPrompt = prompts.value;
      const selected = { source: source.value, template: template.value, provider: provider.value, tabId: tabs.value ? Number(tabs.value) : null, chatURL: tabs.selectedOptions[0]?.dataset.url || null, ratio: ratio.value, duration: Number(duration.value), generation: { ...generation } };
      try {
        const lines = originalPrompt
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean);
        if (!lines.length || lines.length > 50)
          throw Error("Nhập từ 1 đến 50 dòng prompt.");
        if (!selected.provider) throw Error("Chọn AI đang kết nối trước khi xếp tác vụ.");
        if (!["google", "openai"].includes(selected.provider) && (!selected.tabId || !selected.chatURL))
          throw Error("Chọn tab đang kết nối trước khi xếp tác vụ.");
        const snapshot = selected.template ? templates.find(t => t.id === selected.template)?.graph : null;
        if (selected.template && !snapshot) throw Error("Không tìm thấy luồng mẫu.");
        for (const text of lines.flatMap(text => Array.from({ length: kind === "image" ? selected.generation.count : 1 }, () => text))) {
          let graph = snapshot ? structuredClone(snapshot) : emptyGraph();
          if (!snapshot)
            graph.nodes.push({
              id: crypto.randomUUID(),
              type: kind === "image" ? "generateImage" : "generateVideo",
              x: 450,
              y: 100,
              data: {
                studioPrompt: text,
                size: selected.ratio,
                duration: selected.duration,
                quality: selected.generation.quality, resolution: selected.generation.resolution, background: selected.generation.background,
              },
            });
          else {
            const generator = graph.nodes.find((n) =>
              n.type.startsWith("generate"),
            );
            if (!generator) throw Error("Mẫu chưa có bước AI.");
            generator.data.studioPrompt = text;
            for (const n of graph.nodes.filter((n) =>
              n.type.startsWith("generate"),
            )) {
              delete n.data.assetId;
              delete n.data.resultAssets;
              if (["generateImage", "generateVideo"].includes(n.type)) n.data.size = selected.ratio;
              if (["generateImage", "generateVideo"].includes(n.type)) Object.assign(n.data, { quality: selected.generation.quality, resolution: selected.generation.resolution, background: selected.generation.background });
              if (n.type === "generateVideo") n.data.duration = selected.duration;
            }
          }
          if (selected.source) {
            const n = {
                id: crypto.randomUUID(),
                type: "imageInput",
                x: 40,
                y: 100,
                data: { assetId: selected.source },
              },
              target = graph.nodes.find((n) => n.type.startsWith("generate"));
            if (target.type === "generateText")
              throw Error(
                "Mẫu có bước đầu là văn bản, chưa hỗ trợ ảnh trực tiếp.",
              );
            graph.nodes.push(n);
            graph.edges.push({
              id: crypto.randomUUID(),
              source: n.id,
              sourcePort: "image",
              target: target.id,
              targetPort: "reference",
            });
          }
          const job = await createJob({
            projectId: null,
            graph,
            provider: selected.provider,
            tabId: selected.tabId,
            chatURL: selected.chatURL,
            title: text.slice(0, 80),
            kind,
            batchLane: lane,
          });
          created.push(job);
        }
        if (prompts.value === originalPrompt) prompts.value = "";
        prompts.dispatchEvent(new Event("input"));
        await render();
      } catch (e) {
        notice(e.message);
      } finally {
        submit.disabled = false;
        for (const job of created) void startJob(job.id, () => void render()).then(() => render()).catch(e => notice(e.message));
      }
    };
    workspace.append(form);
    void refresh();
  }
  await createLane(1);
  await createLane(2);
  workspace.append(queuePanel);
  let queueRevision = 0, queueKey = "";
  async function render() {
    const revision = ++queueRevision;
    const jobs = (await list("jobs"))
      .filter((j) => j.projectId == null && (j.kind === kind || !j.kind))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!alive || !history.isConnected || revision !== queueRevision) return;
    const nextKey = JSON.stringify(jobs.map(job => [job.id, job.status, job.updatedAt, job.outputs, job.error]));
    if (queueKey === nextKey && history.children.length) return;
    queueKey = nextKey;
    const waiting = jobs.filter(j => j.status === "queued").length,
      running = jobs.filter(j => ["preparing", "sent", "receiving"].includes(j.status)).length,
      done = jobs.filter(j => ["success", "review"].includes(j.status)).length;
    queueStats.textContent = `${waiting} chờ · ${running} đang chạy · ${done} hoàn tất`;
    updateConnectionStatus(running);
    history.replaceChildren();
    for (const job of jobs) {
      const row = el("article", undefined, "queue-row");
      row.append(
        el("strong", job.title),
        el("span", labels[job.status] || job.status, "job-state " + job.status),
      );
      row.dataset.jobId = job.id;
      const total = job.graph.nodes.filter(n => n.type.startsWith("generate")).length,
        completed = job.graph.nodes.filter(n => n.type.startsWith("generate") && job.outputs?.[n.id]).length;
      row.append(el("small", `${job.batchLane ? "Khu " + job.batchLane + " · " : ""}${providerList.find(p => p.id === job.provider)?.name || job.provider}${job.tabId ? " · Tab " + job.tabId : ""} · ${completed}/${total} bước`, "batch-job-meta"));
      const progress = el("progress");
      progress.max = total || 1; progress.value = completed;
      progress.setAttribute("aria-label", "Số bước hoàn tất");
      row.append(progress);
      if (job.error) row.append(el("p", job.error));
      const actions = el("div", undefined, "project-actions");
      if (job.status === "queued")
        actions.append(
          button("Chạy", async () => {
            await startJob(job.id, () => void render());
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
      history.append(row);
    }
    if (!jobs.length) history.append(el("p", "Chưa có tác vụ.", "intro"));
  }
  await recoverJobs();
  await render();
  const timer = setInterval(() => void render(), 3000);
  return () => {
    alive = false;
    abort.abort();
    host.classList.remove("batch-page");
    for (const url of assetURLs.values()) URL.revokeObjectURL(url);
    clearInterval(timer);
  };
}
