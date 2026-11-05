import { mergeJobOutputs, isStale } from "./core/output-state.js";
import { openPostWorkbench } from "./post-workbench.js";
import { mountAssistantChat } from "./assistant-ui.js";
import { nodeAssetIds, promptAssetIds } from "./core/references.js";
import { availableImageTools } from "./core/capabilities.js";
import { icon } from "./icons.js";
import { openImageTool } from "./image-workbench.js";
import { createVideoPrompt } from "./video-prompt.js";
import { createCanvasMenu } from "./canvas-menu.js";
import { createCanvasNavigation } from "./canvas-navigation.js";
import { openCharacterLibrary, openProjectAssetLibrary } from "./canvas-libraries.js";
import { captureFrame } from "./media-tools.js";
import { exportBundle } from "./core/backup.js";
import { ProjectRepository, createProject, exportProject } from "./core/projects.js";
import { GraphController, nodeTypes, topologicalOrder } from "./core/graph.js";
import {
  addAsset,
  readAsset,
  listAssets,
  write,
  list,
  remove,
} from "./core/storage.js";
import { createJob, startJob, stopJob, inspectJob, resumeJob } from "./core/runner.js";
import { api, providerList, connectedAI, el, button, notice } from "./client-api.js";
const repo = new ProjectRepository();
const localNodeNames = { captureLastFrame:'Lấy frame cuối', assembleVideo:'Ghép / xuất MP4',videoTrim:'Cắt video',videoRotate:'Xoay / lật',videoColor:'Chỉnh màu',frameFit:'Vừa khung',audioExtract:'Tách MP3',audioMix:'Trộn nhạc',subtitles:'Phụ đề SRT',voiceSync:'Đồng bộ lời đọc',transition:'Chuyển cảnh',speed:'Tốc độ',watermark:'Logo',voiceover:'Lồng tiếng AI',transcribe:'Nhận diện SRT AI' };

export async function mountStudio(host, id) {
  if (!id) {
    host.innerHTML =
      '<section class="canvas-launcher"><div class="canvas-launcher-toolbar"><a class="back" href="#home" aria-label="Về tổng quan">←<span> Về tổng quan</span></a><h1>Canvas</h1><p class="intro">Mở dự án hoặc tạo một không gian mới.</p></div></section>';
    const launcher = host.querySelector(".canvas-launcher"),
      toolbar = launcher.querySelector(".canvas-launcher-toolbar");
    const actions = el("div", undefined, "project-actions");
    actions.append(
      button("＋ Dự án mới", async () => {
        const p = await repo.save(createProject("Canvas mới"), {
          create: true,
        });
        location.hash = "canvas/" + p.id;
      }),
    );
    const projects = el("div", undefined, "project-list canvas-project-list");
    toolbar.append(actions);
    const pagination = el("nav", undefined, "canvas-pagination");
    pagination.setAttribute("aria-label", "Phân trang workflow");
    launcher.append(projects, pagination);
    let pageNumber = 1, loadRevision = 0;
    async function showPage(requestedPage) {
      const revision = ++loadRevision;
      projects.setAttribute("aria-busy", "true");
      projects.replaceChildren(el("p", "Đang tải workflow…", "muted"));
      try {
        const result = await repo.listPage(requestedPage, 10);
        if (revision !== loadRevision || !launcher.isConnected) return;
        pageNumber = result.page;
        projects.replaceChildren();
        for (const project of result.items) renderCard(project);
        if (!result.total) projects.append(el("p", "Chưa có workflow. Tạo dự án mới để bắt đầu.", "muted"));
        pagination.replaceChildren();
        if (!result.total) return;
        const pages = Math.ceil(result.total / result.pageSize);
        pagination.append(el("span", `${result.total} workflow · Trang ${pageNumber}/${pages}`, "canvas-page-summary"));
        if (pages === 1) return;
        const previous = button("← Trước", () => showPage(pageNumber - 1));
        previous.disabled = pageNumber === 1;
        pagination.append(previous);
        const visiblePages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => pageNumber + i - 2), pages])]
          .filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
        let last = 0;
        for (const page of visiblePages) {
          if (last && page > last + 1) pagination.append(el("span", "…"));
          const control = button(String(page), () => showPage(page));
          control.setAttribute("aria-label", "Trang " + page);
          if (page === pageNumber) {
            control.setAttribute("aria-current", "page");
            control.disabled = true;
          }
          pagination.append(control);
          last = page;
        }
        const next = button("Sau →", () => showPage(pageNumber + 1));
        next.disabled = pageNumber === pages;
        pagination.append(next);
      } catch (e) {
        if (revision === loadRevision && launcher.isConnected) {
          projects.replaceChildren(el("p", e.message, "muted"));
          notice(e.message);
        }
      } finally {
        if (revision === loadRevision) projects.setAttribute("aria-busy", "false");
      }
    }
    function renderCard(p) {
      let current = p;
      const card = el("article", undefined, "project-card canvas-project-card"),
        a = el("a", undefined, "canvas-workflow-title"),
        description = el("textarea", undefined, "canvas-workflow-description"),
        metadata = el("dl", undefined, "canvas-workflow-metadata"),
        controls = el("div", undefined, "project-actions canvas-workflow-actions");
      a.append(el("strong", p.name));
      a.href = "#canvas/" + p.id;
      description.value = p.description || "";
      description.placeholder = "Thêm mô tả workflow…";
      description.maxLength = 2000;
      description.rows = 2;
      description.setAttribute("aria-label", "Mô tả " + p.name);
      description.onchange = async () => {
        description.disabled = true;
        try {
          current = await repo.save({ ...current, description: description.value });
          description.value = current.description;
          await refreshSize();
          notice("Đã lưu mô tả workflow.");
        } catch (e) {
          notice(e.message);
        } finally {
          description.disabled = false;
        }
      };
      const dateText = (date) => date ? new Date(date).toLocaleString("vi-VN") : "Chưa mở";
      for (const [label, value] of [
        ["Thời gian tạo", dateText(p.createdAt)],
        ["Vào gần nhất", dateText(p.lastOpenedAt)],
      ]) {
        const row = el("div");
        row.append(el("dt", label), el("dd", value));
        metadata.append(row);
      }
      const sizeRow = el("div"), size = el("dd", "Đang tính…");
      sizeRow.append(el("dt", "Dung lượng workflow"), size);
      size.title = "Dữ liệu workflow và media tham chiếu, mỗi tệp chỉ tính một lần; không gồm dung lượng quản lý của trình duyệt.";
      metadata.append(sizeRow);
      async function refreshSize() {
        let bytes = new Blob([JSON.stringify(current)]).size, missing = 0;
        const ids = new Set(current.graph.nodes.flatMap(nodeAssetIds));
        for (const id of ids) {
          const asset = await readAsset(id);
          if (asset) bytes += asset.blob.size;
          else missing++;
        }
        const units = ["B", "KB", "MB", "GB"];
        let unit = 0;
        while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
        size.textContent = bytes.toLocaleString("vi-VN", { maximumFractionDigits: unit ? 2 : 0 }) + " " + units[unit] + (missing ? ` · thiếu ${missing} tệp` : "");
      }
      controls.append(
        button("Mở workflow", () => { location.hash = "canvas/" + current.id; }),
        button("Sao chép", async () => {
          await navigator.clipboard.writeText(exportProject(await repo.get(p.id)));
          notice("Đã sao chép JSON workflow; media gốc không nằm trong clipboard.");
        }),
        button("Nhân bản", async () => {
          const original = await repo.get(p.id);
          const copy = createProject(original.name.slice(0, 90) + " · Bản sao", original.description);
          copy.graph = structuredClone(original.graph);
          await repo.save(copy, { create: true });
          await showPage(1);
          notice("Đã nhân bản workflow.");
        }),
        button("Tải xuống", async () => {
          const original = await repo.get(p.id);
          const blob = new Blob([await exportBundle(original)], { type: "application/json" });
          const url = URL.createObjectURL(blob), link = el("a");
          link.href = url;
          link.download = "MooZ-CVN-" + original.id + ".json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
        button("Xóa", async () => {
          if (!confirm(`Xóa workflow “${current.name}”? Media trong Kho vẫn được giữ lại.`)) return;
          await repo.delete(current.id, current.revision);
          await showPage(pageNumber);
          notice("Đã xóa workflow.");
        }, "canvas-workflow-delete"),
      );
      card.append(a, description, metadata, controls);
      projects.append(card);
      void refreshSize().catch(() => { size.textContent = "Chưa đọc được dung lượng"; });
    }
    await showPage(1);
    return () => { loadRevision++; };
  }
  let project = await repo.get(id);
  if (!host.isConnected) return () => {};
  if (!project) {
    host.textContent = "Không tìm thấy dự án.";
    return () => {};
  }
  project = await repo.markOpened(id);
  if (!host.isConnected) return () => {};
  if (!project) { host.textContent = "Dự án đã bị xóa."; return () => {}; }
  const previousJobs = (await list('jobs')).filter(job => job.projectId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const snapshotAssets = new Map();
  for (const job of previousJobs) for (const [assetId, asset] of Object.entries(job.inputAssets || {})) snapshotAssets.set(assetId, { ...asset, id: assetId });
  const storedGraph = JSON.stringify(project.graph);
  for (const job of previousJobs) project.graph = mergeJobOutputs(project.graph, job);
  const recoveredOutputs = JSON.stringify(project.graph) !== storedGraph;
  let controller = new GraphController(project.graph),
    selection = new Set(),
    urls = new Map(),
    saving = Promise.resolve(),
    failed = false,
    disposed = false,
    pan = { ...project.graph.viewport },
    drag = null,
    drawFrame = null,
    wheelSave = null,
    inlineSave = null;
  const referencePickerOpen = new Set(), renderedNodes = new Map(), nodeRenderKeys = new Map(), newAssetCenters = new Map();
  const bindings = new Map(),
    tabLabelRefreshers = new Map(),
    activeJobs = new Map(),
    batches = new Map();
  let canvasNavigation = null, renderedContextKey = "", contextCard = null, busyTabIds = new Set();
  let panMode = false,
    connectionCapabilities = null,
    pendingLink = null,
    linkDrag = null,
    suppressPortClickUntil = 0;
  let suppressMiddlePasteUntil = 0;
  void api("status")
    .then((value) => {
      if (!disposed) {
        connectionCapabilities = value;
        renderContext();
      }
    })
    .catch(() => {});
  document.body.classList.add("studio-mode");
  host.classList.add("studio-host");
  host.replaceChildren();
  const applyJobOutput = job => {
    if (job.projectId !== id || disposed) return;
    const merged = mergeJobOutputs(controller.snapshot(), job);
    for (const node of merged.nodes) {
      const current = controller.snapshot().nodes.find(item => item.id === node.id);
      if (JSON.stringify(current.data) !== JSON.stringify(node.data)) controller.execute({ type: 'updateNode', id: node.id, patch: node.data });
    }
    render(); void persist();
  };
  const abort = new AbortController(),
    shell = el("section", undefined, "cvn-studio"),
    viewport = el("div", undefined, "cvn-viewport"),
    stage = el("div", undefined, "cvn-stage"),
    wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.classList.add("cvn-wires");
  stage.append(wires);
  viewport.append(stage);
  shell.append(viewport);
  const top = el("div", undefined, "cvn-top"),
    cluster = el("div", undefined, "panel cvn-cluster"),
    name = el("input");
  name.value = project.name;
  name.setAttribute("aria-label", "Tên dự án");
  cluster.append(
    button("M", () => (location.hash = "home"), "cvn-mark"),
    name,
    el("span", "Canvas 1"),
  );
  const status = el("small", "Đã lưu"),
    settings = button("Kết nối AI", () => (location.hash = "settings"));
  const backup = button("Sao lưu", async () => {
    const data = await exportBundle({
        ...project,
        name: name.value,
        graph: controller.snapshot(),
      }),
      blob = new Blob([data], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      link = el("a");
    link.href = url;
    link.download = "MooZ-CVN-backup-" + project.id + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const projectMenu = el("details", undefined, "cvn-project-menu"),
    projectToggle = el("summary", "⌄"),
    projectOptions = el("div");
  projectToggle.setAttribute("aria-label", "Menu dự án");
  projectOptions.append(
    button("Chạy toàn bộ luồng", () => showRunGraph()),
    button("Lượt chạy & tiếp tục", () => showProjectRuns()),
    button("Lưu luồng vào Kho", async () => {
      await write("templates", {
        id: crypto.randomUUID(),
        name: project.name,
        graph: templateGraph(),
        createdAt: new Date().toISOString(),
      });
      projectMenu.open = false;
      notice("Đã lưu vào Kho Luồng mẫu");
    }),
  );
  projectMenu.append(projectToggle, projectOptions);
  cluster.append(projectMenu);
  projectOptions.prepend(backup);
  settings.textContent = "";
  settings.setAttribute("aria-label", "Kết nối AI");
  settings.title = "Kết nối AI";
  settings.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6M15 14v6"/></svg>';
  top.append(cluster, status, settings);
  shell.append(top);
  const dock = el("nav", undefined, "panel cvn-dock");
  dock.setAttribute("aria-label", "Công cụ canvas");
  const addMenu = el("details", undefined, "dock-add"),
    addToggle = el("summary", "＋"),
    addOptions = el("div");
  addToggle.setAttribute("aria-label", "Thêm vào canvas");
  addOptions.classList.add("dock-add-panel");
  const addHeading = el("div", undefined, "dock-add-heading"), addSearch = el("input");
  const closeAdd = button("", () => { addMenu.open = false; });
  closeAdd.append(icon("close")); closeAdd.setAttribute("aria-label", "Đóng thêm node");
  addHeading.append(el("span", "Thêm node"), closeAdd);
  addSearch.type = "search";
  addSearch.placeholder = "Tìm loại node…";
  addSearch.setAttribute("aria-label", "Tìm loại node");
  addOptions.append(addHeading, addSearch);
  for (const [type, label, glyph] of [
    ["prompt", "Văn bản", "text"], ["generateText", "Kịch bản", "sparkles"],
    ["generateImage", "Ảnh", "image"], ["generateVideo", "Video", "video"],
    ["audioInput", "Âm thanh", "music"],
    ["assembleVideo", "Ghép MP4", "video"],
    ["videoTrim", "Cắt video", "video"],
  ]) {
    const item = button("", async () => { addMenu.open = false; await addNode(type); });
    item.append(icon(glyph), el("span", label));
    item.dataset.search = label.toLocaleLowerCase("vi");
    addOptions.append(item);
  }
  addOptions.append(el("hr"), el("span", "Thêm tài nguyên", "dock-add-section"));
  for (const [label, glyph, action] of [
    ["Tải lên", "upload", () => { files.accept = "image/*,video/*,audio/*"; files.click(); }],
    ["Chọn từ lịch sử tạo", "clock", () => showHistory()],
  ]) {
    const item = button("", () => { addMenu.open = false; return action(); });
    item.append(icon(glyph), el("span", label));
    item.dataset.search = label.toLocaleLowerCase("vi");
    addOptions.append(item);
  }
  addSearch.oninput = () => {
    const query = addSearch.value.trim().toLocaleLowerCase("vi");
    for (const item of addOptions.querySelectorAll("button")) item.hidden = !item.dataset.search.includes(query);
  };
  addMenu.onpointerenter = event => { if (event.pointerType !== "touch") addMenu.open = true; };
  addMenu.onpointerleave = event => { if (event.pointerType !== "touch") addMenu.open = false; };
  addToggle.onclick = event => { event.preventDefault(); addMenu.open = true; };
  addMenu.ontoggle = () => { addToggle.textContent = addMenu.open ? "×" : "＋"; };
  addMenu.append(addToggle, addOptions);
  const select = button(
    "",
    () => {
      panMode = !panMode;
      select.setAttribute("aria-pressed", String(!panMode));
      select.title = panMode ? "Kéo canvas" : "Chọn đối tượng";
      viewport.style.cursor = panMode ? "grab" : "";
    },
    "dock-selected",
  );
  select.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 14 10-7 1-3 7z"/></svg>';
  select.setAttribute("aria-pressed", "true");
  select.setAttribute("aria-label", "Chọn đối tượng");
  function dockButton(label, name, fn) {
    const b = button("", fn);
    b.setAttribute("aria-label", label);
    b.title = label;
    b.append(icon(name));
    return b;
  }
  dock.append(
    addMenu,
    select,
    dockButton("Phong cách", "materials", showStyles),
    dockButton("Kho", "smile", showCharacters),
    dockButton("Công cụ", "tools", showImageTools),
    dockButton("Lịch sử", "clock", showHistory),
    el("span", undefined, "dock-divider"),
    dockButton("Phím tắt", "keyboard", () => showHelp(true)),
    dockButton("Trợ giúp", "help", () => showHelp(false)),
  );
  const orb = button("", () => showHelp(false), "cvn-orb");
  orb.setAttribute("aria-label", "Trợ lý sáng tạo");
  orb.title = "Trợ lý sáng tạo";
  orb.append(el("span"));
  shell.append(orb);
  shell.append(dock);
  const hud = el("div", undefined, "panel cvn-hud"),
    zoom = el("span", "100%");
  hud.append(
    button("−", () => setZoom(pan.zoom / 1.15)),
    zoom,
    button("＋", () => setZoom(pan.zoom * 1.15)),
    button("Vừa khung", fit),
  );
  shell.append(hud);
  const context = el("div", undefined, "panel cvn-image-toolbar");
  context.hidden = true;
  stage.append(context);
  const files = el("input");
  files.type = "file";
  files.multiple = true;
  files.hidden = true;
  files.accept = "image/*,video/*,audio/*";
  files.onchange = async () => {
    try {
      for (const f of files.files) {
        const a = await addAsset(f, { projectId: id });
        await addAssetNode(a);
      }
      files.value = "";
    } catch (e) {
      notice(e.message);
    }
  };
  shell.append(files);
  // Keep the fullscreen canvas outside the dashboard's content-width limits.
  document.body.append(shell);
  const editor = el("dialog", undefined, "cvn-resource-sheet");
  editor.setAttribute("aria-label", "Tài nguyên dự án");
  document.body.append(editor);
  let dockAnchor = null, dockHoverId = 0, activeInlinePopup = null;
  function positionInlinePopup() {
    if (!activeInlinePopup || !editor.open || !activeInlinePopup.anchor.isConnected) return;
    let anchor = activeInlinePopup.anchor.getBoundingClientRect();
    if (anchor.top < 180 && activeInlinePopup.anchor.closest(".cvn-stage")) {
      pan.y += 180 - anchor.top;
      transform();
      controller.execute({ type: "setViewport", viewport: pan });
      void persist();
      anchor = activeInlinePopup.anchor.getBoundingClientRect();
    }
    editor.classList.add("inline-resource-popover");
    editor.style.inset = "auto";
    editor.style.margin = "0";
    editor.style.transform = "none";
    editor.style.maxHeight = Math.max(96, anchor.top - 24) + "px";
    editor.style.overflowY = "auto";
    editor.style.left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - editor.offsetWidth / 2, innerWidth - editor.offsetWidth - 12)) + "px";
    editor.style.top = Math.max(12, anchor.top - editor.offsetHeight - 12) + "px";
  }
  function bindInlinePopup(control, action) {
    control.setAttribute("aria-expanded", "false");
    control.onclick = event => {
      if (event.detail > 1) return;
      if (activeInlinePopup?.anchor === control && editor.open) { editor.close(); return; }
      closeDockPopup();
      if (activeInlinePopup) activeInlinePopup.anchor.setAttribute("aria-expanded", "false");
      activeInlinePopup = { anchor: control };
      control.setAttribute("aria-expanded", "true");
      Promise.resolve(action()).then(() => { positionInlinePopup(); requestAnimationFrame(positionInlinePopup); }).catch(error => notice(error.message));
    };
  }
  editor.addEventListener("close", () => {
    if (activeInlinePopup) activeInlinePopup.anchor.setAttribute("aria-expanded", "false");
    activeInlinePopup = null;
  });
  document.addEventListener("pointerdown", event => {
    if (activeInlinePopup && !editor.contains(event.target) && !activeInlinePopup.anchor.contains(event.target)) editor.close();
  }, { capture: true, signal: abort.signal });
  function closeDockPopup() {
    dockAnchor = null;
    dockHoverId++;
    if (editor.classList.contains("dock-resource-popover")) editor.close();
  }
  function positionDockPopup() {
    if (!dockAnchor || !editor.open) return;
    editor.classList.add("dock-resource-popover");
    const anchor = dockAnchor.getBoundingClientRect();
    editor.style.inset = "auto";
    editor.style.margin = "0";
    editor.style.transform = "none";
    editor.style.left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - editor.offsetWidth / 2, innerWidth - editor.offsetWidth - 12)) + "px";
    editor.style.top = Math.max(12, anchor.top - editor.offsetHeight - 16) + "px";
    editor.style.setProperty("--dock-tip-left", Math.max(16, Math.min(editor.offsetWidth - 16, anchor.left + anchor.width / 2 - parseFloat(editor.style.left))) + "px");
  }
  function setPointerMode(hand) {
    panMode = hand;
    select.setAttribute("aria-pressed", "true");
    select.dataset.mode = hand ? "hand" : "pointer";
    select.setAttribute("aria-label", hand ? "Bàn tay (H)" : "Di chuyển (V)");
    select.title = hand ? "Bàn tay · Kéo Canvas (H)" : "Di chuyển · Chọn và kéo node (V)";
    select.replaceChildren(icon(hand ? "hand" : "pointer"), el("span", hand ? "H" : "V", "tool-mode-badge"));
    viewport.style.cursor = hand ? "grab" : "";
  }
  function pointerTools() {
    editor.className = "cvn-resource-sheet pointer-tool-menu";
    editor.replaceChildren(popupHeading("Di chuyển", closeDockPopup));
    for (const [name, hand, key] of [["Di chuyển", false, "V"], ["Bàn tay", true, "H"]]) {
      const item = button("", () => { setPointerMode(hand); closeDockPopup(); });
      item.append(icon(hand ? "hand" : "pointer"), el("span", name), el("kbd", key));
      item.setAttribute("aria-pressed", String(panMode === hand));
      editor.append(item);
    }
    if (!editor.open) editor.show();
  }
  function materialTools() {
    resourcePanel("Thư viện vật liệu");
    editor.append(
      button("Thư viện phong cách", () => { showStyles(); requestAnimationFrame(positionDockPopup); }),
      button("Chỉ dẫn hiệu ứng", () => { showVideoHints([...selection][0], "effect"); requestAnimationFrame(positionDockPopup); }),
    );
  }
  for (const control of dock.querySelectorAll(":scope > button")) {
    const label = control.getAttribute("aria-label");
    if (["Kho", "Lịch sử"].includes(label)) continue;
    const original = control.onclick;
    const show = () => {
      if (dockAnchor === control && editor.open) return;
      dockAnchor = control;
      const revision = ++dockHoverId;
      const action = control === select ? pointerTools : label === "Phong cách" ? materialTools : () => original.call(control);
      Promise.resolve(action()).then(() => {
        if (dockAnchor === control && revision === dockHoverId) positionDockPopup();
        else if (editor.classList.contains("dock-resource-popover")) editor.close();
      }).catch(error => notice(error.message));
    };
    control.classList.add("dock-hover-button");
    control.onpointerenter = event => { if (event.pointerType !== "touch") show(); };
    control.onclick = show;
  }
  setPointerMode(false);
  window.addEventListener("pointermove", event => {
    if (!dockAnchor || !editor.open) return;
    const button = dockAnchor.getBoundingClientRect(), panel = editor.getBoundingClientRect();
    const inside = rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const bridge = { left: Math.min(button.left, panel.left), right: Math.max(button.right, panel.right), top: panel.bottom, bottom: button.top };
    if (!inside(button) && !inside(panel) && !inside(bridge)) closeDockPopup();
  }, { signal: abort.signal });
  window.addEventListener("blur", closeDockPopup, { signal: abort.signal });
  function persist() {
    const graph = controller.snapshot();
    status.textContent = "Đang lưu…";
    saving = saving
      .then(async () => {
        if (failed) return;
        project = await repo.save({ ...project, graph });
        if (!disposed) status.textContent = "Đã lưu";
      })
      .catch((e) => {
        failed = true;
        status.textContent = "Chưa lưu được";
        notice(e.message + " · Xuất bản đang mở để giữ thay đổi.");
      });
    return saving;
  }
  function command(c) {
    if (failed) throw Error("Dự án bị xung đột. Tải lại sau khi sao lưu.");
    controller.execute(c);
    if (["moveNodes", "moveNode"].includes(c.type)) refreshNodePositions();
    else render();
    void persist();
  }
  function refreshNodePositions() {
    const graph = controller.snapshot();
    for (const node of graph.nodes) {
      const cached = renderedNodes.get(node.id), card = stage.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
      if (cached) { cached.x = node.x; cached.y = node.y; }
      if (card) { card.style.left = node.x + "px"; card.style.top = node.y + "px"; }
    }
    for (const group of graph.groups) {
      const box = stage.querySelector(`.cvn-group[data-id="${CSS.escape(group.id)}"]`), nodes = graph.nodes.filter(node => group.nodeIds.includes(node.id));
      if (!box || !nodes.length) continue;
      const left = Math.min(...nodes.map(node => node.x)) - 20, top = Math.min(...nodes.map(node => node.y)) - 45;
      Object.assign(box.style, { left: left + "px", top: top + "px", width: Math.max(...nodes.map(node => node.x + (stage.querySelector(`[data-id="${CSS.escape(node.id)}"]`)?.offsetWidth || 340))) - left + 20 + "px", height: Math.max(...nodes.map(node => node.y + (stage.querySelector(`[data-id="${CSS.escape(node.id)}"] .cvn-node-body`)?.offsetHeight || 220))) - top + 20 + "px" });
    }
    renderContext(); scheduleWires(); canvasNavigation?.refresh();
  }
  function canvasMiddle() {
    const drawer = canvasNavigation?.drawerWidth || 0;
    return { x: (drawer + (innerWidth - drawer) / 2 - pan.x) / pan.zoom, y: (innerHeight / 2 - pan.y) / pan.zoom };
  }
  function alignNewAsset(container) {
    const card = container.closest(".cvn-node"), center = card && newAssetCenters.get(card.dataset.id);
    if (!center || disposed) return;
    newAssetCenters.delete(card.dataset.id);
    if (!controller.snapshot().nodes.some(node => node.id === card.dataset.id)) return;
    command({ type: "moveNode", id: card.dataset.id, x: center.x - card.offsetWidth / 2, y: center.y - container.offsetHeight / 2 });
  }
  name.onchange = () => {
    const value = name.value.trim();
    if (!value) {
      name.value = project.name;
      return;
    }
    saving = saving
      .then(async () => {
        project = await repo.save({ ...project, name: value });
      })
      .catch((e) => {
        failed = true;
        notice(e.message);
      });
  };
  function transform() {
    stage.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${pan.zoom})`;
    zoom.textContent = Math.round(pan.zoom * 100) + "%";
    positionNativeMenus();
  }
  function positionNativeMenus() {
    for (const menu of stage.querySelectorAll('.inline-footer details[open]')) {
      const anchor = menu.querySelector(':scope > summary'), panel = menu.querySelector(':scope > div');
      if (!anchor || !panel) continue;
      const rect = anchor.getBoundingClientRect(), origin = menu.getBoundingClientRect();
      panel.style.maxHeight = Math.max(24, Math.min(650, (rect.top - 24) / pan.zoom)) + "px";
      panel.style.maxWidth = Math.max(24, (innerWidth - 24) / pan.zoom) + "px";
      panel.style.overflowY = "auto";
      panel.style.bottom = (origin.bottom - rect.top + 12) / pan.zoom + "px";
      const width = panel.getBoundingClientRect().width;
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12));
      panel.style.left = (left - origin.left) / pan.zoom + "px";
    }
  }
  function setZoom(z) {
    pan.zoom = Math.max(0.1, Math.min(4, z));
    transform();
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  }
  function fit() {
    const nodes = controller.snapshot().nodes;
    if (!nodes.length) return;
    positionFloatingPanels();
    const bounds = nodes.map(n => {
      const card = stage.querySelector(`[data-id="${CSS.escape(n.id)}"]`),
        composer = card?.querySelector(".inline-composer:not([hidden])"),
        toolbar = !context.hidden && selection.has(n.id) ? context : null,
        cardWidth = card?.offsetWidth || 340,
        composerLeft = composer ? (cardWidth - composer.offsetWidth) / 2 : 0;
      return {
        left: Math.min(n.x + Math.min(0, composerLeft), toolbar ? toolbar.offsetLeft - toolbar.offsetWidth / 2 : Infinity),
        right: Math.max(n.x + Math.max(cardWidth, composer ? composerLeft + composer.offsetWidth : 0), toolbar ? toolbar.offsetLeft + toolbar.offsetWidth / 2 : -Infinity),
        top: Math.min(n.y - 28, toolbar ? toolbar.offsetTop : Infinity),
        bottom: n.y + Math.max(card?.offsetHeight || 330, composer ? composer.offsetTop + composer.offsetHeight : 0),
      };
    });
    const x = Math.min(...bounds.map(b => b.left)),
      y = Math.min(...bounds.map(b => b.top)),
      width = Math.max(...bounds.map(b => b.right)) - x,
      height = Math.max(...bounds.map(b => b.bottom)) - y;
    pan.zoom = Math.max(
      0.1,
      Math.min(1, (innerWidth - 80) / width, (innerHeight - 240) / height),
    );
    pan.x = (innerWidth - width * pan.zoom) / 2 - x * pan.zoom;
    pan.y = 90 - y * pan.zoom;
    transform();
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  }
  async function addNode(type, sourceId = null, position = null) {
    if (["imageInput","videoInput","audioInput"].includes(type)) {
      files.accept = type === "imageInput" ? "image/*" : type === "audioInput" ? "audio/*" : "video/*";
      files.click();
      return;
    }
    const center = canvasMiddle(), width = type === "prompt" ? 340 : 460, height = type === "prompt" ? 190 : 258;
    const n = {
      id: crypto.randomUUID(),
      type,
      x: position?.x ?? center.x - width / 2,
      y: position?.y ?? center.y - height / 2,
      data: {
        customName: {
          prompt: "Prompt",
          generateImage: "Tạo ảnh",
          generateVideo: "Tạo video",
          generateText: "Tạo văn bản",
        }[type] || localNodeNames[type] || type,
        text: "",
        studioPrompt: "",
        provider: "muse",
        size: "16:9",
      },
    };
    command({ type: "addNode", node: n });
    if (sourceId) {
      const source = controller
        .snapshot()
        .nodes.find((row) => row.id === sourceId);
      const pair = Object.entries(nodeTypes[source.type].outputs)
        .map(([port, type]) => ({
          port,
          target: Object.entries(nodeTypes[n.type].inputs).find(
            ([, input]) => input === type,
          ),
        }))
        .find((pair) => pair.target);
      if (pair)
        command({
          type: "connect",
          edge: {
            id: crypto.randomUUID(),
            source: sourceId,
            sourcePort: pair.port,
            target: n.id,
            targetPort: pair.target[0],
          },
        });
    }
    selection = new Set([n.id]);
    render();
    openEditor(n.id);
    return n;
  }
  async function addAssetNode(a) {
    const center = canvasMiddle();
    const n = {
      id: crypto.randomUUID(),
      type: a.kind === "video" ? "videoInput" : a.kind === "audio" ? "audioInput" : "imageInput",
      x: center.x - 170,
      y: center.y - 110,
      data: { customName: a.name, assetId: a.id },
    };
    newAssetCenters.set(n.id, center);
    selection = new Set([n.id]);
    command({ type: "addNode", node: n });
  }
  async function assetView(assetId, container) {
    try {
      const a = await readAsset(assetId) || snapshotAssets.get(assetId);
      if (disposed || !container.isConnected) return;
      if (!a) {
        container.append(el("p", "Tài sản đã bị xóa khỏi Kho."));
        return;
      }
      let url = urls.get(a.id);
      if (!url) {
        url = URL.createObjectURL(a.blob);
        urls.set(a.id, url);
      }
      const media = el(a.kind === "image" ? "img" : a.kind);
      media.src = url;
      media.draggable = false;
      if (a.kind !== "image") {
        media.controls = true;
        media.preload = "metadata";
      } else media.alt = a.name;
      container.replaceChildren(media);
      if (media.tagName === "VIDEO") media.addEventListener("loadedmetadata", () => {
        const node = container.closest(".cvn-node");
        if (!node) return;
        const label = node.querySelector(".cvn-dimensions") || el("span", undefined, "cvn-dimensions");
        label.textContent = media.videoWidth + " × " + media.videoHeight;
        node.append(label);
        alignNewAsset(container);
        renderContext();
        scheduleWires();
      }, { once: true });
      media.addEventListener(
        "load",
        () => {
          scheduleWires();
          renderContext();
        },
        { once: true },
      );
      if (media.tagName === "IMG") {
        const node = container.closest(".cvn-node");
        if (node) {
          const label =
            node.querySelector(".cvn-dimensions") ||
            el("span", undefined, "cvn-dimensions");
          label.textContent = "";
          node.append(label);
          media.onload = () => {
            label.textContent =
              media.naturalWidth + " × " + media.naturalHeight;
            alignNewAsset(container);
            scheduleWires();
            renderContext();
          };
        }
      }
    } catch (e) {
      notice(e.message);
    }
  }
  function render() {
    const graph = controller.snapshot();
    const ids = new Set(graph.nodes.map(node => node.id));
    for (const old of stage.querySelectorAll(".cvn-node")) if (!ids.has(old.dataset.id)) {
      bindings.delete(old.dataset.id); tabLabelRefreshers.delete(old.dataset.id);
      renderedNodes.delete(old.dataset.id); nodeRenderKeys.delete(old.dataset.id); old.remove();
    }
    for (const old of stage.querySelectorAll(".cvn-group")) old.remove();
    for (const g of graph.groups) {
      const ns = graph.nodes.filter((n) => g.nodeIds.includes(n.id));
      if (!ns.length) continue;
      const box = el("div", g.name, "cvn-group"),
        left = Math.min(...ns.map((n) => n.x)) - 20,
        top = Math.min(...ns.map((n) => n.y)) - 45;
      Object.assign(box.style, {
        left: left + "px",
        top: top + "px",
        width: Math.max(...ns.map((n) => n.x + 360)) - left + "px",
        height: Math.max(...ns.map((n) => n.y + 340)) - top + "px",
      });
      box.dataset.id = g.id;
      stage.append(box);
    }
    for (const n of graph.nodes) {
      const existing = stage.querySelector(`.cvn-node[data-id="${CSS.escape(n.id)}"]`),
        key = JSON.stringify([n.type, n.data, graph.edges.filter(edge => edge.target === n.id || edge.source === n.id)]);
      if (existing && nodeRenderKeys.get(n.id) === key) {
        const cached = renderedNodes.get(n.id); cached.x = n.x; cached.y = n.y;
        Object.assign(existing.style, { left: n.x + "px", top: n.y + "px" });
        continue;
      }
      const keepMedia = existing && n.data.assetId && renderedNodes.get(n.id)?.data.assetId === n.data.assetId,
        card = existing || el(
          "article",
          undefined,
          "cvn-node " + (selection.has(n.id) ? "selected " : ""),
        ),
        title = el("div", undefined, "cvn-node-title"),
        body = existing?.querySelector(":scope > .cvn-node-body") || el("div", undefined, "cvn-node-body");
      if (existing) for (const child of [...existing.children]) if (child !== body && !(keepMedia && child.classList.contains("cvn-dimensions"))) child.remove();
      if (!keepMedia) body.replaceChildren();
      card.dataset.id = n.id;
      renderedNodes.set(n.id, n);
      nodeRenderKeys.set(n.id, key);
      title.append(el("span", n.data.customName || n.type, "node-title-name"));
      if (["generateImage", "generateVideo"].includes(n.type)) {
        card.classList.add(n.type === "generateImage" ? "image-generation-node" : "video-generation-node");
        title.prepend(icon(n.type === "generateImage" ? "image" : "video"));
      }
      Object.assign(card.style, { left: n.x + "px", top: n.y + "px" });
      card.append(title);
      if (body.parentElement !== card) card.append(body);
      if (["generateImage", "generateVideo"].includes(n.type))
        setPreviewRatio(body, n.data.size || "16:9");
      if (n.data.assetId) {
        if (!card.isConnected) stage.append(card);
        if (!keepMedia) void assetView(n.data.assetId, body);
      } else if (["prompt", "negativePrompt"].includes(n.type)) {
        const text = el("textarea");
        text.value = n.data.text || "";
        text.placeholder = "Viết ý tưởng của bạn…";
        text.setAttribute("aria-label", "Nội dung prompt");
        text.onchange = () =>
          command({
            type: "updateNode",
            id: n.id,
            patch: { text: text.value },
          });
        body.append(text);
      } else if (localNodeNames[n.type]) {
        body.append(icon(['voiceover','audioExtract'].includes(n.type)?'music':'video'),el('p',localNodeNames[n.type]));
      } else if (n.type === "generateText") {
        body.classList.add("script-node-body");
        const text = el("textarea");
        text.value = n.data.text || "";
        text.placeholder = "Kịch bản văn bản sẽ xuất hiện ở đây. Bạn cũng có thể nhập hoặc sửa trực tiếp…";
        text.setAttribute("aria-label", "Nội dung kịch bản");
        text.maxLength = 50000;
        text.oninput = () => { updateInline(n.id, { text: text.value }); renderContext(); };
        body.append(text);
      } else {
        const placeholder = el("span", undefined, "cvn-empty-symbol");
        if (n.type === "generateImage") placeholder.append(icon("image"));
        else if (n.type === "generateVideo") placeholder.append(icon("video"));
        else placeholder.textContent = "▧";
        body.append(
          placeholder,
          el(
            "small",
            n.type === "generateVideo"
              ? "Video của bạn sẽ xuất hiện ở đây"
              : "Ảnh của bạn sẽ xuất hiện ở đây",
          ),
        );
      }
      if (n.type.startsWith("generate")) {
        card.classList.add("generation-node");
        card.append(makeComposer(n));
        if (n.data.resultAssets) {
          try {
            const ids = JSON.parse(n.data.resultAssets);
            if (ids.length > 1) {
              const gallery = el("nav", undefined, "node-results");
              gallery.setAttribute("aria-label", "Kết quả tạo ảnh");
              for (const [i, assetId] of ids.entries()) {
                const b = button(String(i + 1), () =>
                  command({ type: "updateNode", id: n.id, patch: { assetId } }),
                );
                b.setAttribute(
                  "aria-pressed",
                  String(assetId === n.data.assetId),
                );
                gallery.append(b);
              }
              card.append(gallery);
            }
          } catch {}
        }
      }
      if (localNodeNames[n.type]) {
        const configure=button('Thiết lập',()=>{},'node-local-config');configure.setAttribute('aria-label','Thiết lập hậu kỳ');bindInlinePopup(configure,()=>configureLocalNode(n.id));card.append(configure);
      }
      if (!card.isConnected) stage.append(card);
      const more = el("details", undefined, "node-more"),
        toggle = el("summary", "⋯");
      toggle.setAttribute("aria-label", "Thao tác node");
      const menu = el("div");
      menu.append(
        button("Nhân bản", () =>
          command({
            type: "addNode",
            node: {
              ...controller.snapshot().nodes.find((row) => row.id === n.id),
              id: crypto.randomUUID(),
              x: n.x + 660,
              y: n.y,
            },
          }),
        ),
        button("Lưu prompt", async () => {
          await write("prompts", {
            id: crypto.randomUUID(),
            name: n.data.customName || "Prompt",
            text:
              controller.snapshot().nodes.find((row) => row.id === n.id).data
                .studioPrompt ||
              n.data.text ||
              "",
            createdAt: new Date().toISOString(),
          });
          notice("Đã lưu vào Kho Prompt");
        }),
        button("Xóa", () => command({ type: "deleteNode", id: n.id })),
      );
      more.append(toggle, menu);
      card.append(more);
      for (const side of ["input", "output"]) {
        const ports =
          nodeTypes[n.type][side === "input" ? "inputs" : "outputs"];
        if (Object.keys(ports).length) {
          const p = button(
            "+",
            () => {
              if (performance.now() < suppressPortClickUntil) return;
              if (pendingLink && pendingLink.side !== side && pendingLink.id !== n.id) {
                const sourceId = side === "input" ? pendingLink.id : n.id;
                const targetId = side === "input" ? n.id : pendingLink.id;
                pendingLink = null;
                connectNodes(sourceId, targetId);
                return;
              }
              pendingLink = { id: n.id, side };
              for (const old of stage.querySelectorAll(".port-menu")) old.remove();
              const menu = el("div", undefined, "port-menu");
              menu.append(el("small", side === "output" ? "Nối tới node có sẵn" : "Nhận từ node có sẵn"));
              for (const candidate of controller.snapshot().nodes.filter(row => row.id !== n.id)) {
                const sourceId = side === "output" ? n.id : candidate.id;
                const targetId = side === "input" ? n.id : candidate.id;
                const pair = connectionPair(sourceId, targetId);
                const connected = controller.snapshot().edges.some(edge => edge.source === sourceId && edge.target === targetId);
                const item = button((connected ? "✓ " : "") + (candidate.data.customName || candidate.type), () => {
                  pendingLink = null;
                  connectNodes(sourceId, targetId, true);
                });
                item.title = connected ? "Bấm để bỏ nối" : pair?.targetPort === "workflow" ? "Liên kết thứ tự workflow" : "Truyền dữ liệu " + pair?.sourcePort;
                menu.append(item);
              }
              if (side === "output") {
                menu.append(el("small", "Hoặc tạo bước tiếp theo"));
                for (const [type, label] of [["generateImage", "Tạo ảnh"], ["generateVideo", "Tạo video"], ["generateText", "Tạo văn bản"]])
                  menu.append(button(label, () => { pendingLink = null; return addNode(type, n.id); }));
              }
              card.append(menu);
              status.textContent = "Chọn cổng đối diện để nối · Esc để hủy";
            },
            "cvn-port " + side,
          );
          p.dataset.side = side;
          p.onpointerdown = (event) => {
            if (panMode || event.button !== 0) return;
            event.stopPropagation();
            selection = new Set([n.id]);
            renderContext();
            linkDrag = { id: n.id, side, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
            p.setPointerCapture(event.pointerId);
            scheduleWires();
          };
          p.title = Object.keys(ports).join(", ");
          p.setAttribute(
            "aria-label",
            (side === "input" ? "Đầu vào " : "Đầu ra ") +
              (n.data.customName || n.type),
          );
          card.append(p);
        }
      }
      card.onpointerdown = (e) => {
        if (panMode || e.button !== 0) return;
        if (!selection.has(n.id)) {
          selection = new Set([n.id]);
          renderContext();
        }
        if (
          e.target.closest(
            "button,textarea,video,audio,input,select,summary,.inline-composer",
          )
        )
          return;
        e.preventDefault();
        drag = {
          mode: "node",
          id: n.id,
          startX: e.clientX,
          startY: e.clientY,
          x: n.x,
          y: n.y,
          card,
          origins: controller
            .snapshot()
            .nodes.filter((row) => selection.has(row.id))
            .map((row) => ({ id: row.id, x: row.x, y: row.y })),
        };
        card.setPointerCapture(e.pointerId);
      };
      card.onpointermove = (e) => {
        if (drag?.mode !== "node" || drag.id !== n.id) return;
        if (!drag.moving) {
          if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
          drag.moving = true;
          renderContext();
        }
        drag.nx = drag.x + (e.clientX - drag.startX) / pan.zoom;
        drag.ny = drag.y + (e.clientY - drag.startY) / pan.zoom;
        if (canvasNavigation?.snapEnabled) {
          drag.nx = Math.round(drag.nx / 24) * 24;
          drag.ny = Math.round(drag.ny / 24) * 24;
        }
        for (const origin of drag.origins) {
          const target = stage.querySelector(
            `[data-id="${CSS.escape(origin.id)}"]`,
          );
          if (target) {
            target.style.left = origin.x + drag.nx - drag.x + "px";
            target.style.top = origin.y + drag.ny - drag.y + "px";
          }
        }
        scheduleWires();
      };
      card.onpointerup = () => {
        if (drag?.id === n.id) {
          const d = drag;
          drag = null;
          if (d.nx !== undefined)
            command({
              type: "moveNodes",
              moves: d.origins.map((origin) => ({
                id: origin.id,
                x: origin.x + d.nx - d.x,
                y: origin.y + d.ny - d.y,
              })),
            });
        }
      };
      card.onpointercancel = () => {
        drag = null;
        refreshNodePositions();
      };
      card.ondblclick = (e) => {
        if (!e.target.closest("textarea,video,button,input,select,summary"))
          openEditor(n.id);
      };
    }
    renderContext();
    drawWires();
    transform();
    canvasNavigation?.refresh();
    if (!graph.nodes.length) {
      const hint = el(
        "p",
        "Thêm prompt, ảnh hoặc video để bắt đầu.",
        "cvn-start-hint",
      );
      stage.querySelector(".cvn-start-hint")?.remove();
      stage.append(hint);
    } else stage.querySelector(".cvn-start-hint")?.remove();
  }
  function scheduleWires() {
    if (!drawFrame)
      drawFrame = requestAnimationFrame(() => {
        drawFrame = null;
        positionFloatingPanels();
        drawWires();
        canvasNavigation?.refreshMinimap();
      });
  }
  function drawWires() {
    const graph = controller.snapshot();
    const existing = new Map([...wires.querySelectorAll('g[data-edge-id]')].map(group => [group.dataset.edgeId, group])), active = new Set();
    for (const e of graph.edges) {
      const a = stage.querySelector(`[data-id="${CSS.escape(e.source)}"]`),
        b = stage.querySelector(`[data-id="${CSS.escape(e.target)}"]`);
      if (!a || !b) continue;
      const start = portCenter(a, "output"), end = portCenter(b, "input");
      if (!start || !end) continue;
      const x = start.x, y = start.y, tx = end.x, ty = end.y;
      let group = existing.get(e.id);
      if (!group) {
        group = document.createElementNS(wires.namespaceURI, "g"); group.dataset.edgeId = e.id;
        const path = document.createElementNS(wires.namespaceURI, "path"), flow = path.cloneNode();
        flow.classList.add("cvn-wire-flow"); flow.setAttribute("pathLength", "1000");
        group.append(path, flow); wires.append(group);
      }
      active.add(e.id);
      for (const path of group.children) {
        path.setAttribute("d", `M${a.offsetLeft + a.offsetWidth} ${y} L${x} ${y} C${x + 100} ${y},${tx - 100} ${ty},${tx} ${ty} L${b.offsetLeft} ${ty}`);
        path.classList.toggle("workflow-order-wire", e.targetPort === "workflow");
      }
    }
    for (const [id, group] of existing) if (!active.has(id)) group.remove();
    wires.querySelector('.connection-draft-wire')?.remove();
    if (linkDrag) {
      const card = stage.querySelector(`[data-id="${CSS.escape(linkDrag.id)}"]`),
        start = card && portCenter(card, linkDrag.side),
        rect = stage.getBoundingClientRect();
      if (start) {
        const x = (linkDrag.x - rect.left) / pan.zoom, y = (linkDrag.y - rect.top) / pan.zoom,
          path = document.createElementNS(wires.namespaceURI, "path");
        path.setAttribute("d", `M${start.x} ${start.y} C${start.x + (linkDrag.side === "output" ? 100 : -100)} ${start.y},${x} ${y},${x} ${y}`);
        path.classList.add("connection-draft-wire");
        wires.append(path);
      }
    }
  }
  function portCenter(card, side) {
    const port = card.querySelector(`:scope > .cvn-port.${side}`);
    if (!port) return null;
    const rect = port.getBoundingClientRect(), origin = stage.getBoundingClientRect();
    return { x: (rect.left + rect.width / 2 - origin.left) / pan.zoom, y: (rect.top + rect.height / 2 - origin.top) / pan.zoom };
  }
  function connectionPair(sourceId, targetId) {
    const nodes = controller.snapshot().nodes,
      source = nodes.find(row => row.id === sourceId), target = nodes.find(row => row.id === targetId);
    if (!source || !target) throw Error("Node đã bị xóa.");
    for (const [sourcePort, type] of Object.entries(nodeTypes[source.type].outputs)) {
      const accepted = Object.entries(nodeTypes[target.type].inputs).find(([, input]) => input === type || input === "media" && ["image", "video", "audio", "media"].includes(type));
      if (accepted) return { sourcePort, targetPort: accepted[0] };
    }
  }
  function connectNodes(source, target, toggle = false) {
    if (source === target) throw Error("Chọn hai node khác nhau để nối.");
    const pair = connectionPair(source, target);
    if (!pair) throw Error("Chưa tìm thấy cổng nối.");
    const existing = controller.snapshot().edges.find(edge => edge.source === source && edge.target === target && edge.sourcePort === pair.sourcePort && edge.targetPort === pair.targetPort);
    if (existing && !toggle) { notice("Hai node này đã được nối."); return; }
    if (existing) command({ type: "disconnect", id: existing.id });
    else command({ type: "connect", edge: { id: crypto.randomUUID(), source, target, ...pair } });
    status.textContent = existing ? "Đã bỏ nối" : pair.targetPort === "workflow" ? "Đã nối thứ tự workflow" : "Đã nối dữ liệu";
    if (!existing && pair.targetPort === "workflow") notice("Đã nối thứ tự workflow. Hai loại dữ liệu này không được tự chuyển đổi.");
  }
  function setPreviewRatio(body, value) {
    const [width, height] = value.split(":").map(Number);
    if (width > 0 && height > 0) {
      body.style.setProperty("--preview-ratio", `${width} / ${height}`);
      // Portrait previews shrink in width instead of growing beyond the canvas.
      body.parentElement.style.setProperty("--media-node-width", Math.min(460, 340 * width / height) + "px");
      requestAnimationFrame(() => {
        if (!body.isConnected) return;
        for (const port of body.parentElement.querySelectorAll(":scope > .cvn-port"))
          port.style.top = body.offsetTop + body.offsetHeight / 2 - port.offsetHeight / 2 + "px";
        scheduleWires();
      });
    }
  }
  function positionFloatingPanels() {
    if (context.hidden || selection.size !== 1) return;
    const card = stage.querySelector(`[data-id="${CSS.escape([...selection][0])}"]`);
    if (!card) return;
    context.style.left = card.offsetLeft + card.offsetWidth / 2 + "px";
    // The preview block includes its title, with the same gap above and below.
    context.style.top = card.offsetTop - 28 - 24 - context.offsetHeight + "px";
  }
  function renderContext() {
    const movingNode = drag?.mode === "node" && drag.moving;
    for (const card of stage.querySelectorAll(".cvn-node")) {
      const selected = selection.has(card.dataset.id);
      const currentNode = controller.snapshot().nodes.find(node => node.id === card.dataset.id);
      card.classList.toggle("cvn-stale", !!currentNode && isStale(controller.snapshot(), currentNode));
      card.classList.toggle("selected", selected);
      const composer = card.querySelector(".inline-composer");
      if (composer) {
        composer.hidden = !selected || selection.size !== 1 || movingNode;
        if (!selected) for (const menu of composer.querySelectorAll("details[open]")) menu.open = false;
      }
    }
    scheduleWires();
    context.hidden = true;
    if (movingNode || selection.size !== 1) return;
    const n = controller.snapshot().nodes.find((n) => selection.has(n.id));
    if (!n) return;
    const card = stage.querySelector(`[data-id="${CSS.escape(n.id)}"]`);
    const hasMedia = Boolean(card?.querySelector('.cvn-node-body > img,.cvn-node-body > video'));
    if (!["generateText", "prompt", "generateImage", "imageInput", "generateVideo", "videoInput"].includes(n.type) && !hasMedia) return;
    const toolbarKey = JSON.stringify([n.id, n.type, n.data, hasMedia, connectionCapabilities]);
    if (renderedContextKey === toolbarKey && contextCard === card) {
      context.hidden = false; positionFloatingPanels(); return;
    }
    renderedContextKey = toolbarKey; contextCard = card;
    context.replaceChildren();
    if (["generateText", "prompt", "negativePrompt"].includes(n.type)) {
      context.hidden = false;
      context.classList.remove("cvn-video-toolbar");
      context.setAttribute("aria-label", "Công cụ văn bản đã chọn");
      const current = () => controller.snapshot().nodes.find(node => node.id === n.id),
        text = () => current()?.data.text || "";
      const edit = button("Sửa văn bản", () => card.querySelector('.cvn-node-body textarea')?.focus({ preventScroll: true })),
        split = button("Tách văn bản", () => {}),
        download = button("Tải .txt", () => downloadNode(current())),
        copy = button("Sao chép", async () => { await navigator.clipboard.writeText(text()); notice("Đã sao chép văn bản"); }),
        duplicate = button("Nhân bản", () => duplicateNode(current()));
      bindInlinePopup(split, () => {
        resourcePanel("Tách văn bản");
        const mode = el("select"), count = el("p");
        mode.setAttribute("aria-label", "Cách tách văn bản");
        mode.add(new Option("Theo đoạn trống", "paragraph")); mode.add(new Option("Theo từng dòng", "line"));
        const parts = () => text().split(mode.value === "line" ? /\r?\n/ : /\r?\n\s*\r?\n/).map(part => part.trim()).filter(Boolean);
        const update = () => { count.textContent = parts().length + " đoạn · giữ nguyên bản gốc"; };
        mode.onchange = update; update();
        editor.append(mode, count, button("Tạo node từ các đoạn", () => {
          const chunks = parts();
          if (chunks.length < 2 || chunks.length > 50) throw Error("Cần từ 2 đến 50 đoạn để tách.");
          const source = current(), graph = { version: 1, nodes: chunks.map((part, index) => ({ id: crypto.randomUUID(), type: "prompt", x: source.x + 300, y: source.y + index * 220 - 100, data: { text: part, customName: "Đoạn " + (index + 1) } })), edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } };
          command({ type: "insertGraph", graph }); editor.close();
        }));
      });
      download.disabled = copy.disabled = split.disabled = !text().trim();
      context.append(edit, split, download, copy, duplicate);
      positionFloatingPanels();
      return;
    }
    const image = card?.querySelector(".cvn-node-body > img"),
      video = card?.querySelector(".cvn-node-body > video");
    const isVideo = Boolean(video || ["generateVideo", "videoInput"].includes(n.type)),
      isImage = Boolean(image || ["generateImage", "imageInput"].includes(n.type));
    if (!isImage && !isVideo) return;
    context.hidden = false;
    context.classList.toggle("cvn-video-toolbar", isVideo);
    context.setAttribute("aria-label", isVideo ? "Công cụ video đã chọn" : "Công cụ ảnh đã chọn");
    let downloadHost = context, trailingAction = null;
    if (isVideo) {
      const capture = el("details", undefined, "video-frame-menu"),
        label = el("summary"), choices = el("div");
      label.append(icon("camera"), el("span", "Chụp khung hình"), icon("chevronDown"));
      label.setAttribute("aria-label", "Chụp khung hình video");
      for (const [text, time] of [
        ["Khung hình hiện tại", () => video.currentTime || 0],
        ["Khung hình đầu tiên", () => 0],
        ["Khung hình cuối cùng", () => Number.isFinite(video.duration) ? Math.max(0, video.duration - .05) : 0],
      ]) {
        const control = button(text, async () => {
          const asset = await readAsset(n.data.assetId);
          const output = await captureFrame(asset, time());
          capture.open = false;
          await addAssetNode(output);
        });
        control.disabled = !video;
        if (!video) control.title = "Cần video kết quả trước.";
        choices.append(control);
      }
      capture.append(label, choices);
      const fullscreen = button("", async () => {
        if (video.requestFullscreen) await video.requestFullscreen();
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else throw Error("Trình duyệt chưa hỗ trợ mở video toàn màn hình.");
      });
      fullscreen.disabled = !video;
      fullscreen.append(icon("expand"));
      fullscreen.title = "Xem video toàn màn hình";
      fullscreen.setAttribute("aria-label", "Xem video toàn màn hình");
      const post = button("Hậu kỳ", async () => { const asset = await readAsset(n.data.assetId); return openPostWorkbench(asset, { onResult: asset => addAssetNode(asset) }); });
      post.disabled = !video; context.append(post, capture);
      trailingAction = fullscreen;
    } else {
      const primary = el("div", undefined, "image-primary-tools"),
        utilities = el("div", undefined, "image-utility-tools"),
        tools = availableImageTools(connectionCapabilities);
      const action = tool => {
        const b = button("", () => imageTool(n, tool.mode));
        b.append(icon(tool.icon));
        b.disabled = !image;
        b.title = image ? tool.label : "Cần ảnh kết quả trước: " + tool.label;
        b.setAttribute("aria-label", tool.label);
        if (["edit", "grid"].includes(tool.mode)) b.append(el("span", tool.mode === "edit" ? "Chỉnh sửa ảnh" : tool.label));
        return b;
      };
      for (const tool of tools.filter(tool => !["rotate", "draw", "view"].includes(tool.mode))) primary.append(action(tool));
      const more = el("details", undefined, "image-more-menu"),
        label = el("summary"), menu = el("div");
      label.append(el("span", "Thêm"), icon("chevronDown"));
      label.setAttribute("aria-label", "Thêm công cụ ảnh");
      menu.append(
        button("Cắt và điều chỉnh ảnh", () => { more.open = false; if (!image) throw Error("Node chưa có ảnh kết quả."); return imageTool(n, "edit"); }),
        button("Thông tin ảnh", async () => {
          more.open = false;
          const asset = await readAsset(n.data.assetId);
          if (!asset || !image) throw Error("Node chưa có ảnh kết quả.");
          resourcePanel("Thông tin ảnh");
          editor.append(el("p", asset.name), el("p", `${image.naturalWidth} × ${image.naturalHeight} px`), el("p", asset.blob.type + " · " + (asset.blob.size / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " KB"));
        }),
      );
      if (!image) for (const item of menu.querySelectorAll("button")) item.disabled = true;
      more.append(label, menu);
      primary.append(more);
      for (const mode of ["rotate", "draw"]) {
        const tool = tools.find(tool => tool.mode === mode);
        if (tool) utilities.append(action(tool));
      }
      const view = tools.find(tool => tool.mode === "view");
      if (view) trailingAction = action(view);
      context.append(primary, utilities);
      downloadHost = utilities;
    }
    const download = button("", async () => {
      const a = await readAsset(n.data.assetId);
      const link = el("a");
      link.href = URL.createObjectURL(a.blob);
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    download.disabled = !n.data.assetId || isStale(controller.snapshot(), n);
    download.setAttribute("aria-label", isVideo ? "Tải video xuống" : "Tải ảnh xuống");
    download.title = "Tải xuống";
    download.append(icon("download"));
    downloadHost.append(download);
    if (trailingAction) downloadHost.append(trailingAction);
    positionFloatingPanels();
  }
  function updateInline(id, patch) {
    if (failed)
      throw Error("Dự án có xung đột. Hãy sao lưu trước khi tải lại.");
    controller.execute({ type: "updateNode", id, patch });
    clearTimeout(inlineSave);
    if (Object.keys(patch).every(key => ["studioPrompt", "text"].includes(key))) inlineSave = setTimeout(() => void persist(), 180);
    else void persist();
  }
  function openEditor(id) {
    const card = stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card?.querySelector('[aria-label="Thiết lập hậu kỳ"]')) { card.querySelector('[aria-label="Thiết lập hậu kỳ"]').click(); return; }
    card?.querySelector('textarea,[contenteditable="true"]')?.focus({ preventScroll: true });
  }
  function makeComposer(n) {
    const id = n.id,
      kind =
        n.type === "generateImage"
          ? "image"
          : n.type === "generateVideo"
            ? "video"
            : "text";
    const composer = el("section", undefined, "inline-composer");
    if (kind === "image") composer.classList.add("image-prompt-composer");
    if (kind === "video") composer.classList.add("video-prompt-composer");
    if (kind !== "text") composer.classList.add("media-prompt-composer");
    composer.setAttribute(
      "aria-label",
      "Prompt " + (n.data.customName || n.type),
    );
    const tools = el("div", undefined, "inline-tools"),
      refs = el("div", undefined, "inline-refs"),
      chooser = el("section", undefined, "inline-chooser");
    chooser.hidden = !referencePickerOpen.has(id);
    let chooserRevision = 0;
    const upload = el("input");
    upload.type = "file";
    upload.accept = "image/*";
    upload.multiple = true;
    upload.hidden = true;
    upload.onchange = async () => {
      try {
        for (const file of upload.files) {
          const asset = await addAsset(file, { projectId: project.id });
          const source = {
            id: crypto.randomUUID(),
            type: "imageInput",
            x: n.x - 650,
            y: n.y,
            data: { customName: asset.name, assetId: asset.id },
          };
          controller.execute({ type: "addNode", node: source });
          controller.execute({
            type: "connect",
            edge: {
              id: crypto.randomUUID(),
              source: source.id,
              sourcePort: "image",
              target: id,
              targetPort: "reference",
            },
          });
        }
        render();
        await persist();
      } catch (e) {
        notice(e.message);
      }
    };
    tools.append(
      button("＋ Tải lên", () => upload.click()),
      button("Tham chiếu", () => {
        chooser.hidden = !chooser.hidden;
        if (!chooser.hidden) { referencePickerOpen.add(id); void fillChooser(); }
        else referencePickerOpen.delete(id);
      }),
      upload,
    );
    if (kind === "image") {
      const graph = controller.snapshot(),
        reference = n.data.assetId
          ? n
          : graph.edges
              .filter((e) => e.target === id)
              .map((e) => graph.nodes.find((row) => row.id === e.source))
              .find((row) => row?.data.assetId);
      if (reference)
        tools.append(
          button("Đánh dấu", async () => {
            const asset = await readAsset(reference.data.assetId);
            if (!asset || asset.kind !== "image")
              throw Error("Chưa có ảnh tham chiếu để đánh dấu.");
            await openImageTool(asset, "draw", {
              onResult: async (output) => {
                const source = {
                  id: crypto.randomUUID(),
                  type: "imageInput",
                  x: n.x - 660,
                  y: n.y + 300,
                  data: { customName: output.name, assetId: output.id },
                };
                controller.execute({ type: "addNode", node: source });
                controller.execute({
                  type: "connect",
                  edge: {
                    id: crypto.randomUUID(),
                    source: source.id,
                    sourcePort: "image",
                    target: id,
                    targetPort: "reference",
                  },
                });
                render();
                await persist();
              },
            });
          }),
        );
      tools.append(button("Phong cách", () => showStyles(id)));
    }
    if (kind === "video") tools.append(
      button("Kho", () => showCharacters()),
      button("Hiệu ứng", () => showVideoHints(id, "effect")),
      button("Chuyển động máy", () => showVideoHints(id, "motion")),
    );
    function videoReferences() {
      const graph = controller.snapshot(), currentNode = graph.nodes.find(row => row.id === id);
      const sources = graph.edges.filter(edge => edge.target === id && edge.targetPort === "reference")
        .map(edge => graph.nodes.find(node => node.id === edge.source))
        .filter(node => node?.data.assetId && ["imageInput", "generateImage"].includes(node.type));
      const available = new Set([...sources.map(node => node.data.assetId), ...promptAssetIds(currentNode?.data.studioPrompt)]);
      const savedOrder = currentNode?.data.referenceOrder ? JSON.parse(currentNode.data.referenceOrder) : [];
      const assetIds = [...new Set([...savedOrder.filter(assetId => available.has(assetId)), ...available])];
      return assetIds.map((assetId, index) => {
        const node = sources.find(node => node.data.assetId === assetId);
        return { id: assetId, nodeId: node?.id, name: node?.data.customName || "Ảnh tham chiếu", assetId, label: "Ảnh " + (index + 1), number: index + 1 };
      });
    }
    const text = kind === "video"
      ? createVideoPrompt({ value: n.data.studioPrompt || "", getReferences: videoReferences, onChange: value => updateInline(id, { studioPrompt: value }) })
      : el("textarea");
    text.value = n.data.studioPrompt || "";
    text.placeholder =
      kind === "video"
        ? "Mô tả chuyển động, cảnh quay và nội dung video…"
        : "Nhập mô tả để tạo ảnh, hoặc tải ảnh lên và viết yêu cầu chỉnh sửa, ví dụ: đổi nền thành đêm tuyết…";
    text.setAttribute("aria-label", "Nội dung yêu cầu");
    text.maxLength = 50000;
    if (kind !== "video") text.oninput = () => updateInline(id, { studioPrompt: text.value });
    const footer = el("div", undefined, "inline-footer"),
      provider = el("select"),
      settings = el("details", undefined, "inline-settings"),
      summary = el("summary"),
      settingsBody = el("div"),
      ratio = el("select"),
      duration = el("select"),
      connection = el("details", undefined, "inline-connection"),
      tabSummary = el("summary", "Tab AI"),
      tabs = el("select"),
      hint = el("p", undefined, "inline-status");
    footer.addEventListener("toggle", () => positionNativeMenus(), true);
    provider.setAttribute("aria-label", "AI thực hiện");
    provider.add(new Option("Chọn AI…", ""));
    const desiredProvider = n.data.provider || "";
    let providerRevision = 0;
    async function refreshProviders() {
      const revision = ++providerRevision, chosen = provider.value || desiredProvider;
      try {
        const available = await connectedAI(kind);
        if (!composer.isConnected || revision !== providerRevision) return;
        provider.replaceChildren(new Option(available.length ? "Chọn AI…" : "Chưa có AI kết nối", ""));
        for (const item of available) provider.add(new Option(item.name, item.id));
        provider.value = available.some(item => item.id === chosen) ? chosen : "";
        connection.hidden = !provider.value || ["openai", "google"].includes(provider.value);
      } catch (error) {
        if (composer.isConnected && revision === providerRevision) {
          provider.replaceChildren(new Option("Chưa có AI kết nối", ""));
          hint.textContent = error.message;
        }
      }
    }
    provider.addEventListener("focus", () => void refreshProviders());
    ratio.setAttribute("aria-label", "Tỷ lệ");
    for (const r of ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"])
      ratio.add(new Option(r, r));
    ratio.value = n.data.size || "16:9";
    const ratioGrid = el("div", undefined, "ratio-grid");
    ratioGrid.setAttribute("role", "group");
    ratioGrid.setAttribute("aria-label", "Chọn tỷ lệ khung");
    const syncRatioButtons = () => {
      for (const b of ratioGrid.children) b.setAttribute("aria-pressed", String(b.dataset.ratio === ratio.value));
    };
    for (const option of ratio.options) {
      const tile = button("", () => {
        ratio.value = option.value;
        ratio.dispatchEvent(new Event("change"));
      });
      tile.dataset.ratio = option.value;
      tile.setAttribute("aria-label", "Khung " + option.value);
      const shape = el("span", undefined, "ratio-shape");
      const [w, h] = option.value.split(":").map(Number);
      shape.style.width = (w >= h ? 24 : 24 * w / h) + "px";
      shape.style.height = (h >= w ? 24 : 24 * h / w) + "px";
      tile.append(shape, el("span", option.value));
      ratioGrid.append(tile);
    }
    syncRatioButtons();
    duration.setAttribute("aria-label", "Thời lượng");
    for (const d of [5, 10, 15, 30, 40])
      duration.add(new Option(d + " giây", d));
    duration.value = String(n.data.duration || 5);
    duration.hidden = kind !== "video";
    const quality = el("select"), count = el("select"),
      resolution = el("select"), background = el("select");
    const qualityLabels = {
      low: "Thấp", medium: "Tiêu chuẩn", high: "Cao", ultra: "Siêu cao", max: "Tối đa",
    };
    quality.setAttribute("aria-label", kind === "video" ? "Chất lượng video" : "Chất lượng ảnh");
    for (const [value, label] of Object.entries(qualityLabels)) quality.add(new Option(label, value));
    quality.value = n.data.quality || "medium";
    resolution.setAttribute("aria-label", "Độ phân giải");
    for (const value of kind === "video" ? ["480P", "720P", "1080P"] : ["1K", "2K", "4K"])
      resolution.add(new Option(value, value));
    resolution.value = n.data.resolution || (kind === "video" ? "720P" : "1K");
    background.setAttribute("aria-label", "Nền ảnh");
    for (const [value, label] of [["auto", "Tự động"], ["preserve", "Giữ nền"], ["transparent", "Trong suốt"]])
      background.add(new Option(label, value));
    background.value = n.data.background || "auto";
    count.setAttribute("aria-label", "Số ảnh");
    for (const value of [1, 2, 4]) count.add(new Option(value + " ảnh", value));
    count.value = String(n.data.count || 1);
    const refreshSummary = () => {
      const label = `${ratio.value} · ${qualityLabels[quality.value]} · ${resolution.value} · ${kind === "video" ? duration.value + "s" : count.value + " ảnh"}`;
      summary.replaceChildren(icon("frame"), el("span", label), icon("chevronDown"));
    };
    const syncGroups = [];
    const choiceSection = (title, control, field, number = false) => {
      const section = el("section", undefined, "generation-option-section"),
        group = el("div", undefined, "generation-option-choices");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", title);
      section.append(el("h3", title));
      const sync = () => {
        for (const button of group.children) button.setAttribute("aria-pressed", String(button.dataset.value === control.value));
      };
      for (const option of control.options) {
        const tile = button(option.textContent, () => {
          control.value = option.value;
          control.dispatchEvent(new Event("change"));
        });
        tile.dataset.value = option.value;
        group.append(tile);
      }
      control.classList.add("settings-native-select");
      control.tabIndex = -1;
      control.onchange = () => {
        updateInline(id, { [field]: number ? Number(control.value) : control.value });
        sync();
        refreshSummary();
      };
      syncGroups.push(sync);
      section.append(control, group);
      return section;
    };
    settingsBody.classList.add("generation-options-panel");
    settingsBody.append(
      choiceSection("Chất lượng", quality, "quality"),
      choiceSection("Độ phân giải", resolution, "resolution"),
    );
    if (kind === "image") settingsBody.append(choiceSection("Nền ảnh", background, "background"));
    const ratioSection = el("section", undefined, "generation-option-section"),
      ratioLabel = el("h3", "Tỷ lệ khung");
    ratio.classList.add("settings-native-select");
    ratio.tabIndex = -1;
    ratioSection.append(ratioLabel, ratio, ratioGrid);
    settingsBody.append(ratioSection);
    settingsBody.append(kind === "video"
      ? choiceSection("Thời lượng video", duration, "duration", true)
      : choiceSection("Số lượng ảnh", count, "count", true));
    settingsBody.append(el("small", "Đây là yêu cầu đầu ra. Kết quả phụ thuộc model và kết nối AI bạn chọn."));
    ratio.onchange = () => {
      updateInline(id, { size: ratio.value });
      const body = stage.querySelector(`[data-id="${CSS.escape(id)}"] > .cvn-node-body`);
      if (body) setPreviewRatio(body, ratio.value);
      syncRatioButtons();
      scheduleWires();
      refreshSummary();
    };
    for (const sync of syncGroups) sync();
    refreshSummary();
    summary.addEventListener("click", event => { if (event.detail > 1) event.preventDefault(); });
    tabSummary.addEventListener("click", event => { if (event.detail > 1) event.preventDefault(); });
    settingsBody.prepend(popupHeading("Thông số", () => { settings.open = false; }, "Đóng thông số"));
    settings.append(summary, settingsBody);
    settings.hidden = kind === "text";
    tabs.setAttribute("aria-label", "Tab chạy luồng");
    tabs.add(new Option("Chọn tab AI…", ""));
    const connectionPanel = el("div", undefined, "inline-connection-panel");
    connectionPanel.append(popupHeading("Chọn tab AI", () => { connection.open = false; }, "Đóng chọn tab AI"), tabs, button("Cập nhật danh sách", () => refreshTabs()));
    connection.append(tabSummary, connectionPanel);
    function refreshTabSummary(label = "Tab AI") {
      if (kind === "text") tabSummary.textContent = label;
      else tabSummary.replaceChildren(icon("reference"), el("span", label, "tab-binding-label"));
      tabSummary.title = label;
      tabSummary.setAttribute("aria-label", "Chọn tab AI: " + label);
    }
    refreshTabSummary();
    const binding = bindings.get(id);
    if (binding?.provider === provider.value) {
      const o = new Option(binding.title, binding.id);
      o.dataset.url = binding.url;
      tabs.add(o);
      tabs.value = String(binding.id);
      refreshTabSummary(binding.title);
    }
    let tabRevision = 0;
    const tabLabel = (tab, state = "Sẵn sàng") => {
      const validIds = new Set(controller.snapshot().nodes.map(node => node.id));
      const count = [...bindings].filter(([nodeId, binding]) => validIds.has(nodeId) && binding.id === Number(tab.id)).length;
      return `${count} node · ${tab.title || tab.url} · ${state}`;
    };
    tabLabelRefreshers.set(id, () => {
      for (const option of [...tabs.options].filter(option => option.value)) {
        const state = option.dataset.state === "Mất kết nối" ? "Mất kết nối" : option.dataset.busy === "true" || busyTabIds.has(Number(option.value)) ? "Đang xử lý" : "Sẵn sàng";
        option.textContent = tabLabel({ id: option.value, title: option.dataset.title || bindings.get(id)?.title || option.textContent }, state);
      }
      const selected = tabs.selectedOptions[0];
      refreshTabSummary(selected?.value ? selected.textContent : "Chọn tab AI");
    });
    async function refreshTabs() {
      const seq = ++tabRevision,
        value = provider.value;
      tabs.disabled = true;
      try {
        const [available, jobs] = await Promise.all([api("tabs?provider=" + value), list("jobs")]);
        if (!composer.isConnected || seq !== tabRevision) return;
        tabs.replaceChildren(new Option("Chọn tab AI…", ""));
        busyTabIds = new Set(jobs.filter(job => ["preparing", "sent", "receiving"].includes(job.status)).map(job => job.tabId));
        for (const t of available) {
          const state = t.busy || jobs.some(job => job.tabId === t.id && ["preparing", "sent", "receiving"].includes(job.status)) ? "Đang xử lý" : "Sẵn sàng";
          const o = new Option(tabLabel(t, state), t.id);
          o.dataset.url = t.url;
          o.dataset.title = t.title || t.url;
          o.dataset.state = state;
          o.dataset.busy = String(Boolean(t.busy));
          tabs.add(o);
        }
        const saved = bindings.get(id);
        if (saved?.provider === value) {
          if (!available.some((t) => t.id === saved.id)) {
            const offline = new Option(tabLabel({ id: saved.id, title: saved.title }, "Mất kết nối"), saved.id);
            offline.dataset.url = saved.url;
            offline.dataset.title = saved.title;
            offline.dataset.state = "Mất kết nối";
            offline.disabled = true;
            tabs.add(offline);
          }
          tabs.value = String(saved.id);
        }
        tabLabelRefreshers.get(id)?.();
        hint.textContent = available.length
          ? ""
          : "Chưa có tab kết nối. Mở Kết nối AI ở góc trên.";
      } catch (e) {
        if (composer.isConnected && seq === tabRevision)
          hint.textContent = e.message;
      } finally {
        if (seq === tabRevision) tabs.disabled = false;
      }
    }
    connection.ontoggle = () => {
      if (connection.open) void refreshTabs();
    };
    tabs.onchange = () => {
      const o = tabs.selectedOptions[0];
      if (tabs.value)
        bindings.set(id, {
          id: Number(tabs.value),
          url: o.dataset.url,
          title: o.dataset.title || o.textContent,
          provider: provider.value,
        });
      else bindings.delete(id);
      for (const update of tabLabelRefreshers.values()) update();
    };
    provider.onchange = () => {
      providerRevision++;
      updateInline(id, { provider: provider.value });
      bindings.delete(id);
      for (const update of tabLabelRefreshers.values()) update();
      tabs.replaceChildren(new Option("Chọn tab AI…", ""));
      refreshTabSummary();
      connection.hidden = ["openai", "google"].includes(provider.value);
      if (!connection.hidden && provider.value) { connection.open = true; void refreshTabs(); }
    };
    connection.hidden = ["openai", "google"].includes(provider.value);
    queueMicrotask(() => void refreshProviders());
    const send = button(
      "↑",
      async () => {
        if (batches.has(id)) {
          batches.get(id).cancelled = true;
          if (activeJobs.has(id)) await stopJob(activeJobs.get(id));
          return;
        }
        updateInline(id, {
          studioPrompt: text.value,
          provider: provider.value,
          size: ratio.value,
          ...(kind === "video" ? { duration: Number(duration.value) } : {}),
        });
        clearTimeout(inlineSave);
        await persist();
        const graph = controller.snapshot(),
          required = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const edge of graph.edges)
            if (required.has(edge.target) && !required.has(edge.source)) {
              required.add(edge.source);
              changed = true;
            }
        }
        const subset = {
          ...graph,
          nodes: graph.nodes.filter((n) => required.has(n.id)),
          edges: graph.edges.filter(
            (e) => required.has(e.source) && required.has(e.target),
          ),
          groups: [],
        };
        const b = bindings.get(id);
        const batch = { cancelled: false };
        batches.set(id, batch);
        try {
          const outputs = [];
          const total =
            kind === "image"
              ? controller.snapshot().nodes.find((row) => row.id === id).data
                  .count || 1
              : 1;
          for (let attempt = 0; attempt < total; attempt++) {
            if (batch.cancelled) break;
            const job = await createJob({
              projectId: project.id,
              graph: subset,
              provider: provider.value,
              tabId: b?.provider === provider.value ? b.id : null,
              chatURL: b?.provider === provider.value ? b.url : null,
              title: n.data.customName || project.name,
              kind,
            });
            activeJobs.set(id, job.id);
            send.disabled = false;
            send.textContent = "■";
            send.setAttribute("aria-label", "Dừng tạo");
            try {
              const result = await startJob(job.id, (j) => {
                const message =
                  {
                    queued: "Chờ lượt",
                    preparing: "Chuẩn bị",
                    sent: "Đang chờ AI…",
                    receiving: "Nhận kết quả",
                    success: "Đã tạo xong",
                    unknown: "Cần kiểm tra kết quả",
                    error: "Có lỗi",
                  }[j.status] || j.status;
                hint.textContent = message;
                status.textContent = message;
              });
              if (result.status !== "success") {
                hint.textContent = result.error || "Tác vụ chưa hoàn tất.";
                notice(hint.textContent);
                if (outputs.length) render();
                return;
              }
              for (const [nodeId, output] of Object.entries(result.outputs))
                if (
                  subset.nodes
                    .find((n) => n.id === nodeId)
                    ?.type.startsWith("generate")
                ) {
                  controller.execute({
                    type: "updateNode",
                    id: nodeId,
                    patch: output.assetId
                      ? { assetId: output.assetId }
                      : { text: output.text },
                  });
                }
              if (result.outputs[id]?.assetId)
                outputs.push(result.outputs[id].assetId);
              if (outputs.length)
                controller.execute({
                  type: "updateNode",
                  id,
                  patch: { resultAssets: JSON.stringify(outputs) },
                });
              await persist();
            } finally {
              activeJobs.delete(id);
              send.textContent = "↑";
              send.setAttribute(
                "aria-label",
                kind === "video" ? "Tạo video" : "Tạo ảnh",
              );
            }
          }
          render();
        } finally {
          batches.delete(id);
          activeJobs.delete(id);
        }
      },
      "inline-send",
    );
    send.setAttribute(
      "aria-label",
      kind === "video"
        ? "Gửi tạo video"
        : kind === "image"
          ? "Gửi tạo ảnh"
          : "Gửi tạo văn bản",
    );
    text.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        send.click();
      }
    });
    tools.firstElementChild.disabled = kind === "text";
    if (kind !== "text") {
      footer.classList.add("media-prompt-footer");
      const model = el("div", undefined, "inline-model-group");
      model.append(icon("model"), provider);
      const shortcuts = el("div", undefined, "inline-generation-tools");
      const style = button("", () => showStyles(id));
      style.append(icon("materials"));
      style.setAttribute("aria-label", "Mẫu tạo nội dung");
      style.title = "Mẫu tạo nội dung";
      bindInlinePopup(style, () => showCreationTemplates(id));
      const camera = button("", () => showCamera(id));
      camera.append(el("span", undefined, "lens-glyph"));
      camera.classList.toggle("camera-configured", Boolean(n.data.cameraPrompt));
      camera.setAttribute("aria-label", "Ống kính và máy ảnh");
      camera.title = n.data.cameraPrompt || "Chọn máy ảnh và ống kính";
      bindInlinePopup(camera, () => showCamera(id));
      const options = button("", () => { settings.open = !settings.open; });
      options.append(icon("sliders"));
      options.setAttribute("aria-label", "Thông số tạo ảnh/video");
      options.title = "Thông số";
      options.onclick = event => { if (event.detail <= 1) settings.open = !settings.open; };
      shortcuts.append(style, camera, connection, options);
      footer.append(model, settings, shortcuts, send);
    } else footer.append(provider, settings, connection, send);
    const expand = button("", () => {});
    expand.onclick = (event) => {
      event.stopPropagation();
      if (event.detail > 1) return;
      composer.classList.toggle("expanded");
      expand.setAttribute(
        "aria-expanded",
        String(composer.classList.contains("expanded")),
      );
      positionFloatingPanels();
    };
    expand.append(icon("expand"));
    expand.setAttribute("aria-expanded", "false");
    expand.setAttribute("aria-label", "Mở rộng prompt");
    expand.title = "Mở rộng prompt";
    tools.append(expand);
    if (kind !== "text") {
      for (const b of tools.querySelectorAll("button")) {
        const label = b.textContent;
        const toolIcon = label.includes("Tải lên") ? "upload" : label === "Tham chiếu" ? "reference" : label === "Đánh dấu" ? "pin" : label === "Phong cách" ? "style" : label === "Kho" ? "smile" : label === "Hiệu ứng" ? "sparkles" : label === "Chuyển động máy" ? "motion" : null;
        if (label === "Phong cách") bindInlinePopup(b, () => showStyles(id));
        if (label === "Hiệu ứng") bindInlinePopup(b, () => showVideoHints(id, "effect"));
        if (label === "Chuyển động máy") bindInlinePopup(b, () => showVideoHints(id, "motion"));
        if (toolIcon) {
          const caption = el("span", label.replace("＋ ", ""));
          b.replaceChildren(icon(toolIcon), caption);
        }
      }
    }
    composer.append(tools, refs, chooser, text, footer, hint);
    const incoming = kind === "video"
      ? [...videoReferences().map(reference => ({ source: reference.nodeId, assetReference: reference })), ...controller.snapshot().edges.filter(edge => edge.target === id && edge.targetPort === "video" && controller.snapshot().nodes.find(node => node.id === edge.source)?.data.assetId)]
      : controller.snapshot().edges.filter(edge => edge.target === id && ["reference", "video"].includes(edge.targetPort) && controller.snapshot().nodes.find(node => node.id === edge.source)?.data.assetId);
    for (const [index, edge] of incoming.entries()) {
      const source = edge.assetReference
        ? { id: edge.source, data: { assetId: edge.assetReference.assetId, customName: edge.assetReference.name } }
        : controller.snapshot().nodes.find((n) => n.id === edge.source);
      const chip = button(
        source?.data.customName || "Nguồn",
        () => {
          if (kind === "video" && videoReferences().some(reference => reference.assetId === source?.data.assetId)) text.insertReference(source.data.assetId);
          else {
            chooser.hidden = false;
            referencePickerOpen.add(id);
            void fillChooser();
          }
        },
        "inline-ref",
      );
      chip.setAttribute("aria-label", "Tham chiếu " + (index + 1) + ": " + (source?.data.customName || "Nguồn"));
      chip.title = source?.data.customName || "Nguồn tham chiếu";
      if (source?.data.assetId) {
        chip.textContent = "";
        const preview = el("span");
        chip.append(preview);
        void (async () => {
          const asset = await readAsset(source.data.assetId);
          if (asset && ["image", "video"].includes(asset.kind) && preview.isConnected) {
            let url = urls.get(asset.id);
            if (!url) { url = URL.createObjectURL(asset.blob); urls.set(asset.id, url); }
            const media = el(asset.kind === "image" ? "img" : "video");
            media.src = url; media.draggable = false;
            if (asset.kind === "image") media.alt = asset.name;
            else { media.muted = true; media.preload = "metadata"; preview.append(el("span", "▶", "reference-video-indicator")); }
            preview.prepend(media);
          }
        })();
      }
      const reference = kind === "video" ? videoReferences().find(reference => reference.assetId === source?.data.assetId) : null;
      chip.append(el("span", String(reference?.number || index + 1), "inline-ref-number"));
      if (reference) {
        chip.draggable = true;
        chip.dataset.referenceAssetId = reference.id;
        chip.title = "Kéo vào prompt hoặc bấm để chèn " + reference.label;
        chip.ondragstart = event => {
          event.dataTransfer.setData("application/x-mooz-reference", reference.id);
          event.dataTransfer.setData("text/plain", reference.label);
          event.dataTransfer.effectAllowed = "copyMove";
        };
      }
      refs.append(chip);
    }
    if (kind === "video") {
      refs.ondragover = event => {
        if (![...event.dataTransfer.types].includes("application/x-mooz-reference")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
      };
      refs.ondrop = event => {
        const assetId = event.dataTransfer.getData("application/x-mooz-reference");
        if (!assetId) return;
        event.preventDefault();
        event.stopPropagation();
        const order = videoReferences().map(reference => reference.id);
        if (!order.includes(assetId)) return;
        const before = event.target.closest("[data-reference-asset-id]")?.dataset.referenceAssetId;
        if (before === assetId) return;
        const next = order.filter(id => id !== assetId);
        const index = before ? next.indexOf(before) : next.length;
        next.splice(index < 0 ? next.length : index, 0, assetId);
        updateInline(id, { referenceOrder: JSON.stringify(next) });
        render();
      };
    }
    async function fillChooser() {
      const version = ++chooserRevision;
      chooser.replaceChildren();
      const heading = el("div", undefined, "reference-picker-heading"),
        close = button("", () => { chooser.hidden = true; referencePickerOpen.delete(id); });
      close.append(icon("close")); close.setAttribute("aria-label", "Đóng bảng tham chiếu");
      heading.append(el("strong", "Ảnh & video trên Canvas"), close);
      const grid = el("div", undefined, "canvas-reference-grid");
      chooser.append(heading, grid);
      const graph = controller.snapshot(), seen = new Set();
      for (const source of graph.nodes.filter(source => source.id !== id && source.data.assetId)) {
        try {
          const asset = await readAsset(source.data.assetId);
          if (version !== chooserRevision || !chooser.isConnected) return;
          if (!asset || !["image", "video"].includes(asset.kind) || seen.has(asset.id)) continue;
          seen.add(asset.id);
          const output = Object.entries(nodeTypes[source.type].outputs).find(([, type]) => type === asset.kind),
            input = Object.entries(nodeTypes[n.type].inputs).find(([, type]) => type === asset.kind);
          if (!output || !input) continue;
          const existing = graph.edges.find(edge => edge.source === source.id && edge.target === id && edge.sourcePort === output[0] && edge.targetPort === input[0]);
          const tile = button("", () => {
            referencePickerOpen.add(id);
            selection = new Set([id]);
            if (existing) command({ type: "disconnect", id: existing.id });
            else command({ type: "connect", edge: { id: crypto.randomUUID(), source: source.id, sourcePort: output[0], target: id, targetPort: input[0] } });
          }, "canvas-reference-card");
          tile.setAttribute("aria-label", (asset.kind === "image" ? "Ảnh: " : "Video: ") + asset.name);
          tile.setAttribute("aria-pressed", String(Boolean(existing)));
          tile.title = asset.name + (existing ? " · Bấm để bỏ chọn" : " · Bấm để chọn tham chiếu");
          const preview = el("div", undefined, "canvas-reference-preview"),
            media = el(asset.kind === "image" ? "img" : "video");
          let url = urls.get(asset.id);
          if (!url) { url = URL.createObjectURL(asset.blob); urls.set(asset.id, url); }
          media.src = url; media.draggable = false;
          if (asset.kind === "image") media.alt = asset.name;
          else { media.muted = true; media.preload = "metadata"; }
          preview.append(media, el("span", asset.kind === "image" ? "Ảnh" : "▶ Video", "reference-kind-badge"));
          if (existing) preview.append(el("span", "✓", "reference-selected-badge"));
          tile.append(preview, el("span", asset.name, "reference-file-name"));
          grid.append(tile);
        } catch (error) {
          if (version !== chooserRevision || !chooser.isConnected) return;
          notice(error.message);
        }
      }
      if (version === chooserRevision && chooser.isConnected && !grid.childElementCount)
        grid.append(el("p", "Chưa có ảnh/video trong Canvas. Tải tệp lên hoặc tạo kết quả trước để chọn tham chiếu.", "reference-picker-empty"));
    }
    if (!chooser.hidden) queueMicrotask(() => void fillChooser());
    return composer;
  }
  function selectedImage() {
    const n = controller
      .snapshot()
      .nodes.find((n) => selection.has(n.id) && n.data.assetId);
    return n;
  }
  async function imageTool(n, mode) {
    const asset = await readAsset(n.data.assetId);
    if (!asset) throw Error("Ảnh đã bị xóa khỏi Kho.");
    return openImageTool(asset, mode, {
      onResult: async (output) => {
        if (!disposed) await addAssetNode(output);
      },
    });
  }
  function popupHeading(title, onClose, closeLabel = "Đóng") {
    const heading = el("div", undefined, "resource-panel-heading"), close = button("", onClose);
    close.append(icon("close"), el("span", "Đóng")); close.setAttribute("aria-label", closeLabel);
    heading.append(el("h2", title), close);
    return heading;
  }
  function resourcePanel(title) {
    editor.classList.remove("creative-assistant", "camera-sheet", "shortcut-popover", "pointer-tool-menu", "dock-resource-popover", "inline-resource-popover", "creation-template-sheet", "style-preset-sheet");
    editor.removeAttribute("style");
    if (activeInlinePopup) requestAnimationFrame(positionInlinePopup);
    else if (dockAnchor) requestAnimationFrame(positionDockPopup);
    editor.replaceChildren(popupHeading(title, () => editor.close()));
    if (!editor.open) editor.show();
  }
  function showCreationTemplates(targetId) {
    resourcePanel("Mẫu tạo nội dung");
    editor.classList.add("creation-template-sheet");
    const heading = el("div", undefined, "creation-template-heading");
    heading.append(...editor.childNodes);
    const columns = el("div", undefined, "creation-template-columns"),
      left = el("div"), right = el("div");
    columns.append(left, right);
    const groups = [
      [left, "Phân cảnh & kể chuyện", [
        ["Bảng phân cảnh chuyển động", "motion", "Thiết kế bảng phân cảnh với các hành động và hướng chuyển động nối tiếp rõ ràng, giữ nhất quán nhân vật và bối cảnh."],
        ["Bảng phân cảnh", "layers", "Trình bày câu chuyện thành bảng phân cảnh điện ảnh, bố cục các khung rõ ràng, nhất quán nhân vật và ánh sáng."],
        ["25 khung liên tiếp", "grid", "Tạo một bảng phân cảnh gồm 25 khung trong bố cục 5×5, hành động diễn tiến liên tục, giữ nhất quán nhân vật."],
        ["Diễn biến bốn khung", "layout", "Tạo bố cục bốn khung mô tả tình huống, hành động, cao trào và kết quả, cùng nhân vật và bối cảnh."],
        ["Tiếp diễn sau 3 giây", "clock", "Dựa vào ảnh tham chiếu, hình dung khung hình tiếp diễn sau khoảng 3 giây, giữ liên tục chủ thể, bối cảnh và hướng chuyển động."],
        ["Tiếp diễn sau 5 giây", "clock", "Dựa vào ảnh tham chiếu, hình dung khung hình tiếp diễn sau khoảng 5 giây, giữ liên tục chủ thể và phong cách hình ảnh."],
      ]],
      [left, "Chất liệu & ánh sáng", [
        ["Chi tiết chân dung", "smile", "Chân dung tự nhiên, giữ đặc điểm nhận dạng và chi tiết da, ánh sáng mềm, không làm mịn quá mức."],
        ["Ánh sáng điện ảnh", "camera", "Ánh sáng điện ảnh có chiều sâu, kiểm soát vùng sáng tối, màu sắc nhất quán, giữ chủ thể tự nhiên."],
      ]],
      [right, "Bố cục & góc máy", [
        ["Chín ô góc máy", "grid", "Tạo một ảnh bố cục 3×3 mô tả cùng chủ thể qua chín góc máy, giữ nhất quán ngoại hình và bối cảnh."],
        ["Toàn · trung · cận", "frame", "Tạo một ảnh gồm ba khung toàn cảnh, trung cảnh và cận cảnh của cùng chủ thể, nhất quán ánh sáng và tạo hình."],
      ]],
      [right, "Thiết lập hình ảnh", [
        ["Nhân vật ba góc nhìn", "smile", "Tạo một ảnh thiết lập nhân vật gồm góc chính diện, nghiêng và phía sau đặt cạnh nhau, giữ nguyên trang phục và tỷ lệ cơ thể."],
        ["Khuôn mặt ba góc nhìn", "image", "Tạo một ảnh chân dung gồm chính diện, góc ba phần tư và nghiêng, cùng một nhân vật, giữ nhất quán khuôn mặt."],
        ["Thiết kế nhân vật", "style", "Tạo bản thiết lập nhân vật rõ trang phục, dáng người, phụ kiện và bảng màu, giữ đặc điểm nhân dạng của ảnh tham chiếu."],
        ["Thiết lập bối cảnh", "layers", "Tạo bản thiết lập bối cảnh nêu rõ bố cục không gian, vật liệu, nguồn sáng và các chi tiết chính."],
        ["Thiết lập sản phẩm", "panorama", "Tạo ảnh thiết lập sản phẩm với các góc thể hiện hình dáng và chi tiết, giữ đúng màu sắc, chất liệu, nhãn và tỷ lệ."],
      ]],
    ];
    for (const [column, title, templates] of groups) {
      const section = el("section"); section.append(el("h3", title));
      for (const [label, glyph, instruction] of templates) {
        const action = button("", () => {
          const node = controller.snapshot().nodes.find(node => node.id === targetId && node.type.startsWith("generate"));
          if (!node) throw Error("Chọn một node tạo ảnh hoặc video trước.");
          updateInline(targetId, { stylePrompt: instruction });
          render(); editor.close();
          notice("Đã áp dụng mẫu: " + label);
        });
        action.append(icon(glyph), el("span", label));
        action.title = instruction;
        section.append(action);
      }
      column.append(section);
    }
    editor.append(heading, columns, el("p", "Chọn mẫu để thêm chỉ dẫn cho node đang chọn.", "creation-template-note"));
  }
  function showStyles(targetId) {
    resourcePanel("Phong cách");
    editor.classList.add("style-preset-sheet");
    const choices = el("div", undefined, "style-choice-grid");
    editor.append(choices);
    for (const [label, prompt] of [
      [
        "Điện ảnh",
        "Phong cách điện ảnh, ánh sáng có chủ đích, bố cục giàu chiều sâu, màu sắc nhất quán.",
      ],
      [
        "Chân dung",
        "Chân dung tự nhiên, giữ nhận diện, chi tiết da chân thực và hậu cảnh mềm.",
      ],
      [
        "Sản phẩm",
        "Ảnh sản phẩm studio, ánh sáng rõ, giữ hình dáng, màu sắc và nhãn thật.",
      ],
      [
        "Hoạt hình",
        "Phong cách hoạt hình với đường nét rõ ràng, ánh sáng và màu sắc hài hòa.",
      ],
    ])
      choices.append(
        button(label, () => {
          const n = controller
            .snapshot()
            .nodes.find(
              (n) =>
                n.id === (targetId || [...selection][0]) &&
                n.type.startsWith("generate"),
            );
          if (!n) throw Error("Chọn bước tạo ảnh/video trước.");
          updateInline(n.id, { stylePrompt: prompt });
          render();
          editor.close();
          notice("Đã áp dụng phong cách " + label);
        }),
      );
  }
  function showVideoHints(id, type) {
    resourcePanel(type === "motion" ? "Chuyển động máy" : "Chỉ dẫn hiệu ứng");
    editor.append(el("p", "Chọn chỉ dẫn để thêm vào yêu cầu tạo video."));
    const choices = type === "motion"
      ? [["Máy cố định", "Máy quay cố định, bố cục ổn định."], ["Lia ngang", "Máy quay lia ngang mượt theo chủ thể."], ["Tiến gần", "Máy quay từ từ tiến gần chủ thể."], ["Lùi xa", "Máy quay từ từ lùi xa để mở rộng không gian."], ["Quỹ đạo", "Máy quay di chuyển theo quỹ đạo quanh chủ thể."]]
      : [["Chuyển động chậm", "Chuyển động chậm, giữ hành động tự nhiên."], ["Hạt phim", "Kết cấu hạt phim điện ảnh nhẹ."], ["Ánh sáng sương", "Ánh sáng xuyên sương, không khí điện ảnh."]];
    for (const [label, value] of [...choices, ["Không dùng", ""]]) editor.append(button(label, () => {
      updateInline(id, { [type === "motion" ? "motionPrompt" : "effectPrompt"]: value });
      editor.close();
      notice("Đã lưu chỉ dẫn video");
    }));
  }
  function showCamera(id) {
    resourcePanel("Máy ảnh và ống kính");
    editor.classList.add("camera-sheet");
    const heading = el("div", undefined, "camera-sheet-heading");
    heading.append(...editor.childNodes);
    editor.append(heading);
    const node = controller.snapshot().nodes.find(row => row.id === id);
    if (!node) { editor.close(); return; }
    const form = el("form", undefined, "camera-picker"),
      grid = el("div", undefined, "camera-picker-grid"),
      camera = el("select"), lens = el("select"),
      focal = el("select"), aperture = el("select"),
      enabled = el("input");
    const presets = [
      ["Máy ảnh", camera, ["Sony Venice", "ARRI Alexa 35", "Panavision DXL2", "Blackmagic URSA"], node.data.cameraBody || "Sony Venice", "camera"],
      ["Ống kính", lens, ["Zeiss Ultra Prime", "ARRI Signature Prime", "Cooke S4", "Leica Summilux-C"], node.data.cameraLens || "Zeiss Ultra Prime", "lens"],
      ["Tiêu cự", focal, ["18", "24", "35", "50", "85", "135"], node.data.cameraFocal || "35", "focal"],
      ["Khẩu độ", aperture, ["1.4", "2", "2.8", "4", "5.6", "8", "11"], node.data.cameraAperture || "4", "aperture"],
    ];
    for (const [name, control, choices, selected, mode] of presets) {
      const column = el("div", undefined, "camera-picker-column"),
        card = el("label", undefined, "camera-picker-card"),
        visual = el("span", undefined, "camera-picker-visual " + mode);
      control.id = "camera-" + mode + "-" + id;
      card.htmlFor = control.id;
      card.append(el("span", name, "camera-picker-caption"), visual);
      control.setAttribute("aria-label", name);
      for (const value of choices)
        control.add(new Option(mode === "focal" ? value + " mm" : mode === "aperture" ? "f/" + value : value, value));
      control.value = choices.includes(selected) ? selected : choices[0];
      const refresh = () => {
        if (mode === "camera") visual.replaceChildren(icon("camera"));
        else if (mode === "focal") visual.textContent = control.value;
        else visual.replaceChildren(el("span", undefined, mode === "lens" ? "camera-lens-art" : "camera-aperture-art"));
      };
      const step = (direction) => {
        control.selectedIndex = (control.selectedIndex + direction + choices.length) % choices.length;
        refresh();
      };
      const previous = button("", () => step(-1)), next = button("", () => step(1));
      previous.append(icon("chevronUp"));
      next.append(icon("chevronDown"));
      previous.setAttribute("aria-label", name + " trước");
      next.setAttribute("aria-label", name + " sau");
      control.onchange = refresh;
      refresh();
      column.append(previous, card, next, control);
      grid.append(column);
    }
    enabled.type = "checkbox";
    enabled.checked = node.data.cameraEnabled !== "off";
    enabled.setAttribute("role", "switch");
    enabled.setAttribute("aria-label", "Bật chỉ dẫn máy ảnh và ống kính");
    const toggle = el("label", undefined, "camera-picker-toggle"),
      footer = el("div", undefined, "camera-picker-footer"),
      save = el("button", "Áp dụng"),
      note = el("p", "Lựa chọn được lưu như chỉ dẫn phong cách chụp cho AI.", "camera-picker-note");
    toggle.append(el("span", "Bật chỉ dẫn"), enabled);
    save.type = "submit";
    footer.append(toggle, save);
    form.append(grid, note, footer);
    form.onsubmit = (e) => {
      e.preventDefault();
      updateInline(id, {
        cameraBody: camera.value,
        cameraLens: lens.value,
        cameraFocal: focal.value,
        cameraAperture: aperture.value,
        cameraEnabled: enabled.checked ? "on" : "off",
        cameraPrompt: enabled.checked
          ? `${camera.value}, ${lens.value}, tiêu cự ${focal.value} mm, khẩu độ f/${aperture.value}.`
          : "",
      });
      render();
      editor.close();
      notice(enabled.checked ? "Đã lưu máy ảnh và ống kính" : "Đã tắt chỉ dẫn máy ảnh");
    };
    editor.append(form);
  }
  async function showCharacters() {
    editor.close();
    const targetId = [...selection][0],
      target = controller.snapshot().nodes.find(node => node.id === targetId),
      canReference = Boolean(target && ["generateImage", "generateVideo"].includes(target.type));
    return openCharacterLibrary({
      projectId: project.id, signal: abort.signal, canReference,
      onAdd: asset => addAssetNode(asset),
      onReference: async person => {
        const current = controller.snapshot().nodes.find(node => node.id === targetId);
        if (!current || !canReference) throw Error("Chọn một node tạo ảnh/video để nhận tham chiếu.");
        const asset = await readAsset(person.assetId);
        if (!asset || asset.kind !== "image") throw Error("Ảnh nhân vật không còn trong Kho.");
        const snapshot = controller.snapshot();
        if (snapshot.edges.some(edge => edge.target === current.id && edge.targetPort === "reference" && snapshot.nodes.find(node => node.id === edge.source)?.data.assetId === asset.id)) return;
        const source = { id: crypto.randomUUID(), type: "imageInput", x: current.x - 660, y: current.y, data: { customName: person.name, assetId: person.assetId } };
        controller.execute({ type: "addNode", node: source });
        controller.execute({ type: "connect", edge: { id: crypto.randomUUID(), source: source.id, sourcePort: "image", target: current.id, targetPort: "reference" } });
        selection = new Set([current.id]); render(); await persist();
      },
    });
  }
  function showImageTools() {
    resourcePanel("Công cụ ảnh");
    editor.append(button("Kho tài nguyên", showAssets));
    for (const { label, mode } of availableImageTools(connectionCapabilities))
      editor.append(
        button(label, async () => {
          const n = selectedImage();
          if (!n) throw Error("Chọn một ảnh trên canvas trước.");
          editor.close();
          await imageTool(n, mode);
        }),
      );
  }
  function showHelp(shortcuts = false) {
    resourcePanel(shortcuts ? "Phím tắt" : "Trợ lý sáng tạo");
    if (shortcuts) {
      editor.classList.add("shortcut-popover");
      const grid = el("div", undefined, "shortcut-grid");
      for (const [heading, rows] of [
        ["Tạo nội dung", [["Sao chép node", "Ctrl/Cmd C"], ["Nhân bản", "Ctrl/Cmd D"], ["Dán", "Ctrl/Cmd V"], ["Gửi prompt", "Ctrl/Cmd Enter"]]],
        ["Thu phóng", [["Phóng to / thu nhỏ", "Cuộn chuột"], ["Vừa khung", "Nút zoom → Vừa khung"], ["Bản đồ Canvas", "Nút bản đồ ở góc trái"]]],
        ["Di chuyển", [["Chọn / kéo node", "V"], ["Kéo Canvas", "H"], ["Nối hai node", "Giữ chuột trên + rồi kéo"]]],
        ["Thao tác khác", [["Hoàn tác", "Ctrl/Cmd Z"], ["Làm lại", "Ctrl/Cmd Shift Z"], ["Xóa node", "Delete"], ["Hủy nối / đóng bảng", "Esc"]]],
      ]) {
        const column = el("section"); column.append(el("h3", heading));
        for (const [label, keys] of rows) { const row = el("div"); row.append(el("span", label), el("kbd", keys)); column.append(row); }
        grid.append(column);
      }
      editor.append(grid);
      return;
    }
    editor.classList.add("creative-assistant");
    const heading = el("div", undefined, "creative-assistant-heading");
    heading.append(...editor.childNodes);
    editor.append(heading);
    mountAssistantChat(editor, {
      projectId: project.id, signal: abort.signal,
      onCreate: async (type, prompt) => {
        const node = await addNode(type);
        updateInline(node.id, { studioPrompt: prompt });
        render(); editor.close();
      },
    });
  }
  async function executeGraph(graph, provider='local', tab=null, seedAccepted=true) {
    if(activeJobs.has('__all__'))throw Error('Luồng đang chạy. Đợi hoặc dừng lượt hiện tại.');
    const job=await createJob({projectId:id,graph,provider,tabId:tab?.id||null,chatURL:tab?.url||null,title:project.name,kind:'workflow',seedAccepted});
    activeJobs.set('__all__',job.id);status.textContent='Đang chạy luồng…';
    try{const result=await startJob(job.id,update=>{status.textContent=update.localProgress||update.status;});notice(result.status==='success'?'Đã hoàn tất luồng':result.error||result.status);return result;}
    finally{activeJobs.delete('__all__');renderContext();}
  }
  async function showRunGraph() {
    resourcePanel('Chạy toàn bộ luồng');
    const graph=controller.snapshot(), generators=graph.nodes.filter(node=>node.type.startsWith('generate')), provider=el('select'),tabs=el('select'),reuse=el('input'),reuseLabel=el('label');
    reuse.type='checkbox';reuse.checked=true;reuseLabel.append(reuse,el('span','Chỉ chạy phần thiếu / kết quả đã cũ'));
    provider.setAttribute('aria-label','AI chạy toàn bộ luồng');tabs.setAttribute('aria-label','Tab chạy toàn bộ luồng');
    provider.add(new Option(generators.length?'Chọn AI…':'Xử lý local · không gửi AI',generators.length?'':'local'));
    if(generators.length){const kind=generators.some(node=>node.type==='generateVideo')?'video':generators.some(node=>node.type==='generateImage')?'image':'text';for(const item of await connectedAI(kind))if(generators.every(node=>item.types.includes(node.type==='generateText'?'text':node.type==='generateVideo'?'video':'image')))provider.add(new Option(item.name,item.id));}
    provider.onchange=async()=>{tabs.replaceChildren(new Option('Chọn đúng tab chạy cả luồng',''));if(!['local','google','openai',''].includes(provider.value))for(const tab of await api('tabs?provider='+provider.value)){const option=new Option(tab.title||tab.url,tab.id);option.dataset.url=tab.url;tabs.add(option);}};
    editor.append(provider,tabs,reuseLabel,button('Chạy luồng đã chốt',async()=>{if(!provider.value)throw Error('Chọn AI đang kết nối.');const tab=tabs.value?{id:Number(tabs.value),url:tabs.selectedOptions[0].dataset.url}:null;if(!['local','google','openai'].includes(provider.value)&&!tab)throw Error('Chọn tab chạy toàn bộ luồng.');editor.close();await executeGraph(controller.snapshot(),provider.value,tab,reuse.checked);}),button('Dừng luồng',async()=>{const jobId=activeJobs.get('__all__');if(jobId)await stopJob(jobId);}));
  }
  async function showProjectRuns() {
    resourcePanel('Lượt chạy của Canvas');
    for(const job of (await list('jobs')).filter(job=>job.projectId===id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
      const row=el('section');row.append(el('strong',job.title+' · '+job.status),el('small','Task ID: '+job.id),el('p',job.error||''));
      if(job.status==='unknown')row.append(button('Kiểm tra kết quả',async()=>{await inspectJob(job.id);await showProjectRuns();}));
      if(['error','review','stopped'].includes(job.status)){
        const output=job.outputs[job.activeNode],text=el('textarea');if(output?.accepted===false){text.value=output.text;text.setAttribute('aria-label','Sửa JSON kịch bản');row.append(text);}
        row.append(button('Tiếp tục phần còn thiếu',async()=>{await resumeJob(job.id,output?.accepted===false?text.value:null);editor.close();await startJob(job.id);await showProjectRuns();}));
      }
      editor.append(row);
    }
  }
  function configureLocalNode(nodeId) {
    const node=controller.snapshot().nodes.find(node=>node.id===nodeId);if(!node)return;
    resourcePanel(localNodeNames[node.type]);
    const form=el('form',undefined,'local-node-settings'),settings=node.data.localSettings?JSON.parse(node.data.localSettings):{},fields={};
    const specs={videoTrim:[['trimStart','Bắt đầu (giây)',0],['trimEnd','Kết thúc · 0 đến hết',0]],videoRotate:[['rotation','Góc 0/90/180/270',0],['flipHorizontal','Lật ngang',false]],videoColor:[['brightness','Độ sáng −0,5…0,5',0],['contrast','Tương phản 0,1…3',1],['saturation','Bão hòa 0…3',1]],frameFit:[['size','Tỷ lệ đích','16:9']],audioMix:[['musicVolume','Âm lượng nhạc 0…2',.5],['originalVolume','Âm lượng gốc 0…2',1],['muteOriginal','Tắt âm gốc',false],['loop','Lặp nhạc',true]],subtitles:[['fontSize','Cỡ chữ 10…80',24]],voiceSync:[['fit','freeze hoặc stretch','freeze'],['lines','Mỗi dòng ứng với một cảnh','']],transition:[['transition','fade/dissolve/wipeleft/slideright','fade'],['duration','Đoạn chồng (giây)',.3]],speed:[['speed','Tốc độ 0,25…4',1]],watermark:[['logoWidth','Rộng logo (%)',16],['opacity','Độ rõ logo',.8],['margin','Lề',20],['position','bottomRight/bottomLeft/topRight/topLeft','bottomRight']],voiceover:[['voice','Giọng OpenAI','coral'],['speed','Tốc độ giọng',1]]};
    for(const [key,label,value]of specs[node.type]||[]){const wrap=el('label'),control=el(key==='lines'?'textarea':'input');if(key!=='lines')control.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text';if(control.type==='number')control.step='any';if(control.type==='checkbox')control.checked=settings[key]??value;else control.value=settings[key]??value;control.setAttribute('aria-label',label);wrap.append(el('span',label),control);form.append(wrap);fields[key]=control;}
    const captions=el('textarea');if(node.type==='subtitles'){captions.value=node.data.captions||'';captions.setAttribute('aria-label','SRT của node');form.append(captions);}
    const text=el('textarea');if(node.type==='voiceover'){text.value=node.data.text||'';text.maxLength=4096;text.setAttribute('aria-label','Lời đọc khi không nối Text');form.append(text);}
    const order=el('div');
    function updateOrder(){order.replaceChildren();const graph=controller.snapshot(),incoming=graph.edges.filter(edge=>edge.target===nodeId&&['video','videos','audio'].includes(edge.targetPort));for(const [index,edge]of incoming.entries()){const row=el('div'),siblings=incoming.filter(item=>item.targetPort===edge.targetPort);row.append(el('span',graph.nodes.find(item=>item.id===edge.source)?.data.customName||edge.source));for(const [label,delta]of [['↑',-1],['↓',1]])row.append(button(label,()=>{const ids=siblings.map(item=>item.id),from=ids.indexOf(edge.id),to=from+delta;if(to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to],ids[from]];command({type:'reorderInputs',target:nodeId,port:edge.targetPort,edgeIds:ids});updateOrder();}));order.append(row);}}
    updateOrder();form.append(order,el('p','Chỉ lấy nguồn đã nối đúng cổng. Kết quả mới được lưu riêng, giữ nguyên nguồn.'));
    if(['voiceover','transcribe'].includes(node.type))form.append(el('p','Lượt này gửi văn bản hoặc media đến OpenAI API, có thể tính phí.'));
    const run=el('button','Lưu thông số & chạy node');run.type='submit';form.append(run);form.onsubmit=async event=>{event.preventDefault();run.disabled=true;try{
      const values=Object.fromEntries(Object.entries(fields).map(([key,control])=>[key,control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value]));
      command({type:'updateNode',id:nodeId,patch:{localSettings:JSON.stringify(values),...(node.type==='subtitles'?{captions:captions.value}:{}),...(node.type==='voiceover'?{text:text.value}:{})}});
      const graph=controller.snapshot(),required=new Set([nodeId]);let changed=true;while(changed){changed=false;for(const edge of graph.edges)if(required.has(edge.target)&&!required.has(edge.source)){required.add(edge.source);changed=true;}}
      graph.nodes=graph.nodes.filter(item=>required.has(item.id));graph.edges=graph.edges.filter(edge=>required.has(edge.source)&&required.has(edge.target));graph.groups=[];
      if(graph.nodes.some(item=>item.type.startsWith('generate')&&!item.data.assetId&&!item.data.text))throw Error('Tạo/xác nhận kết quả AI ở bước nguồn trước hoặc dùng Chạy toàn bộ luồng.');
      const target=graph.nodes.find(item=>item.id===nodeId);delete target.data.assetId;delete target.data.outputKey;
      const readyNodes=graph.nodes.filter(item=>item.type.startsWith('generate'));
      if(readyNodes.some(item=>isStale(graph,item)))throw Error('Nguồn AI đã cũ; chạy lại nguồn trước.');
      editor.close();await executeGraph(graph,'local',null,true);
    }catch(error){notice(error.message);}finally{run.disabled=false;}};
    editor.append(form);
  }

  function templateGraph() {
    const graph = controller.snapshot();
    for (const n of graph.nodes)
      if (n.type.startsWith("generate") || n.type === "preview") {
        delete n.data.assetId;
        delete n.data.resultAssets;
        if (n.type === "generateText") delete n.data.text;
      }
    return graph;
  }
  async function showHistory() {
    editor.close();
    return openProjectAssetLibrary({ projectId: project.id, signal: abort.signal, onAdd: asset => addAssetNode(asset) });
  }
  async function showAssets() {
    resourcePanel("Kho tài nguyên");
    const nav = el("div", undefined, "project-actions"),
      body = el("section");
    editor.append(nav, body);
    async function show(kind) {
      body.replaceChildren();
      if (kind === "media") {
        for (const a of await listAssets()) {
          if (!["image", "video"].includes(a.kind)) continue;
          body.append(
            button(
              (a.source === "upload" ? "Đầu vào · " : "Kết quả · ") + a.name,
              async () => {
                await addAssetNode(a);
                editor.close();
              },
            ),
          );
        }
      } else
        for (const item of await list(kind)) {
          body.append(
            button(item.name, () => {
              if (kind === "prompts") {
                command({
                  type: "addNode",
                  node: {
                    id: crypto.randomUUID(),
                    type: "prompt",
                    x: 150,
                    y: 200,
                    data: { customName: item.name, text: item.text },
                  },
                });
              } else command({ type: "insertGraph", graph: item.graph });
              editor.close();
              positionFloatingPanels();
            }),
          );
        }
      if (!body.childNodes.length)
        body.append(el("p", "Chưa có tài nguyên trong khu này."));
    }
    nav.append(
      button("Media", () => show("media")),
      button("Prompt", () => show("prompts")),
      button("Luồng mẫu", () => show("templates")),
    );
    if (!editor.open) editor.show();
    await show("media");
  }

  const rightMenu = createCanvasMenu(abort.signal);
  let copiedNode = null;
  const historyStep = redo => { redo ? controller.redo() : controller.undo(); render(); void persist(); };
  function duplicateNode(node, point = null) {
    const center = canvasMiddle(), card = stage.querySelector(`[data-id="${CSS.escape(node.id)}"]`),
      position = point || { x: center.x - (card?.offsetWidth || 340) / 2, y: center.y - (card?.querySelector(".cvn-node-body")?.offsetHeight || 220) / 2 };
    const copy = { ...structuredClone(node), id: crypto.randomUUID(), ...position };
    selection = new Set([copy.id]);
    command({ type: "addNode", node: copy });
  }
  async function copyNode(node) {
    copiedNode = structuredClone(node);
    try { await navigator.clipboard.writeText(JSON.stringify({ format: "mooz-cvn-node", node: copiedNode })); }
    catch { notice("Đã sao chép node trong Canvas. Trình duyệt chưa cho ghi clipboard hệ thống."); }
  }
  function pasteText(text, point) {
    if (text.length > 5 * 1024 * 1024) throw Error("Nội dung dán quá lớn.");
    let data;
    try { data = JSON.parse(text); } catch {}
    if (data?.format === "mooz-cvn-node" && data.node) duplicateNode(data.node, point);
    else if (text.trim()) {
      const center = canvasMiddle(), position = point || { x: center.x - 170, y: center.y - 96 };
      const node = { id: crypto.randomUUID(), type: "prompt", ...position, data: { text, customName: "Văn bản" } };
      selection = new Set([node.id]);
      command({ type: "addNode", node });
    }
  }
  async function pasteNode(point) {
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch {
      if (!copiedNode) throw Error("Trình duyệt chưa cho đọc clipboard. Dùng Ctrl/Cmd + V trên Canvas.");
      duplicateNode(copiedNode, point);
      return;
    }
    if (text) pasteText(text, point);
    else if (copiedNode) duplicateNode(copiedNode, point);
  }
  async function saveNodeAsset(node) {
    const asset = await readAsset(node.data.assetId);
    if (!asset) throw Error("Node chưa có tài sản để lưu.");
    await write(asset.source === "upload" ? "inputs" : "results", { ...asset, savedAt: new Date().toISOString(), savedProjectIds: [...new Set([...(asset.savedProjectIds || []), project.id])] });
    notice("Đã lưu tài sản vào Kho " + (asset.source === "upload" ? "Đầu vào" : "Kết quả"));
    canvasNavigation?.refresh();
  }
  async function downloadNode(node) {
    if (isStale(controller.snapshot(), node)) throw Error("Thông số hoặc nguồn đã đổi. Chạy lại để tải kết quả hiện hành; tệp cũ vẫn trong Kho.");
    const asset = node.data.assetId && await readAsset(node.data.assetId);
    const isText = ["prompt", "generateText"].includes(node.type);
    const blob = asset?.blob || new Blob([isText ? node.data.text || "" : JSON.stringify({ format: "mooz-cvn-node", node }, null, 2)], { type: isText ? "text/plain;charset=utf-8" : "application/json" });
    const link = el("a"), url = URL.createObjectURL(blob);
    link.href = url;
    link.download = asset?.name || (node.data.customName || "MooZ-node") + (isText ? ".txt" : ".json");
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function copyNodeImage(node) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw Error("Trình duyệt chưa hỗ trợ sao chép ảnh.");
    const asset = await readAsset(node.data.assetId);
    if (asset?.kind !== "image") throw Error("Chọn node có ảnh.");
    let blob = asset.blob;
    if (blob.type !== "image/png") {
      const bitmap = await createImageBitmap(blob);
      try {
        if (bitmap.width * bitmap.height > 32 * 1024 * 1024) throw Error("Ảnh quá lớn để sao chép.");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      } finally { bitmap.close(); }
    }
    if (!blob) throw Error("Không sao chép được ảnh.");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    notice("Đã sao chép ảnh.");
  }
  async function createCharacterFromNode(node) {
    const asset = await readAsset(node.data.assetId);
    if (asset?.kind !== "image") throw Error("Chọn ảnh nhân vật hoặc chụp khung hình video trước.");
    const name = prompt("Tên nhân vật", node.data.customName || asset.name);
    if (!name?.trim()) return;
    await write("characters", { id: crypto.randomUUID(), name: name.trim().slice(0, 100), assetId: asset.id, createdAt: new Date().toISOString() });
    notice("Đã thêm nhân vật vào thư viện.");
  }
  function arrangeWorkflow() {
    const graph = controller.snapshot(), levels = new Map(), columns = new Map();
    for (const id of topologicalOrder(graph)) {
      const parents = graph.edges.filter(edge => edge.target === id).map(edge => levels.get(edge.source) || 0),
        level = parents.length ? Math.max(...parents) + 1 : 0,
        card = stage.querySelector(`[data-id="${CSS.escape(id)}"]`),
        item = { id, width: card?.offsetWidth || 340, height: card?.querySelector(".cvn-node-body")?.offsetHeight || 220 };
      levels.set(id, level);
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level).push(item);
    }
    const moves = [];
    let x = 0;
    for (const [, items] of [...columns].sort(([a], [b]) => a - b)) {
      let y = 160;
      for (const item of items) {
        moves.push({ id: item.id, x, y });
        y += item.height + 30;
      }
      x += Math.max(...items.map(item => item.width)) + 80;
    }
    if (moves.length) command({ type: "moveNodes", moves });
  }
  shell.addEventListener("contextmenu", event => {
    if (event.target.closest('input,textarea,select,[contenteditable="true"],.cvn-dock,.cvn-top,.cvn-hud,.cvn-image-toolbar,.canvas-assets-drawer')) return;
    event.preventDefault();
    pendingLink = null;
    linkDrag = null;
    drag = null;
    clearConnectionTargets();
    const card = event.target.closest(".cvn-node"),
      node = controller.snapshot().nodes.find(node => node.id === card?.dataset.id),
      origin = stage.getBoundingClientRect(),
      point = { x: (event.clientX - origin.left) / pan.zoom, y: (event.clientY - origin.top) / pan.zoom };
    selection = new Set(node ? [node.id] : []);
    renderContext();
    const items = [];
    if (node) {
      const image = Boolean(card.querySelector(".cvn-node-body > img"));
      items.push(
        { label: "Lưu vào Kho tài sản", disabled: !node.data.assetId, action: () => saveNodeAsset(node) },
        ...(image ? [{ label: "Xem trước ảnh", action: () => imageTool(node, "view") }, { label: "Tạo nhân vật", action: () => createCharacterFromNode(node) }] : []),
        { label: "Sắp xếp workflow", action: arrangeWorkflow },
        { separator: true },
        { label: "Tải xuống", action: () => downloadNode(node) },
        { label: "Sao chép node", shortcut: "Ctrl/Cmd C", action: () => copyNode(node) },
        ...(image ? [{ label: "Sao chép ảnh", action: () => copyNodeImage(node) }] : []),
        { label: "Nhân bản", shortcut: "Ctrl/Cmd D", action: () => duplicateNode(node) },
        { label: "Dán", shortcut: "Ctrl/Cmd V", action: () => pasteNode(point) },
        { label: "Xóa", shortcut: "Delete", danger: true, action: () => command({ type: "deleteNode", id: node.id }) },
      );
    } else items.push(
      { label: "Tải lên", action: () => { files.accept = "image/*,video/*,audio/*"; files.click(); } },
      { label: "Lưu vào Kho tài sản", disabled: true, title: "Chọn một node có ảnh hoặc video trước." },
      { label: "Thêm node", children: [["prompt", "Văn bản"], ["generateText", "Kịch bản"], ["generateImage", "Ảnh"], ["generateVideo", "Video"], ["audioInput", "Âm thanh"], ...Object.entries(localNodeNames).map(([type,label])=>[type,label])].map(([type, label]) => ({ label, action: () => addNode(type, null, point) })) },
      { separator: true },
      { label: "Hoàn tác", shortcut: "Ctrl/Cmd Z", disabled: !controller.canUndo, action: () => historyStep(false) },
      { label: "Làm lại", shortcut: "Ctrl/Cmd Shift Z", disabled: !controller.canRedo, action: () => historyStep(true) },
      { separator: true },
      { label: "Dán", shortcut: "Ctrl/Cmd V", action: () => pasteNode(point) },
    );
    rightMenu.show(items, event.clientX, event.clientY);
  }, { signal: abort.signal });
  document.addEventListener("paste", event => {
    if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    try { pasteText(text, null); } catch (error) { notice(error.message); }
  }, { signal: abort.signal });

  canvasNavigation = createCanvasNavigation({
    shell, hud, zoomNode: zoom, projectId: id, signal: abort.signal,
    getName: () => project.name,
    getGraph: () => controller.snapshot(),
    getRects: () => controller.snapshot().nodes.map(node => {
      const card = stage.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
      return { id: node.id, name: node.data.customName || node.type, x: card?.offsetLeft ?? node.x, y: card?.offsetTop ?? node.y, width: card?.offsetWidth || 340, height: card?.querySelector(".cvn-node-body")?.offsetHeight || 220 };
    }),
    onSelectNode: nodeId => {
      const node = controller.snapshot().nodes.find(node => node.id === nodeId);
      if (!node) return;
      selection = new Set([nodeId]); renderContext();
      const card = stage.querySelector(`[data-id="${CSS.escape(nodeId)}"]`);
      centerCanvasAt(node.x + (card?.offsetWidth || 340) / 2, node.y + (card?.querySelector(".cvn-node-body")?.offsetHeight || 220) / 2);
    },
    onCenter: centerCanvasAt,
    onLayout: arrangeWorkflow,
    onOpenLibrary: () => showHistory(),
    onUseAsset: asset => addAssetNode(asset),
    onUsePrompt: item => {
      const center = canvasMiddle();
      const node = { id: crypto.randomUUID(), type: "prompt", x: center.x - 170, y: center.y - 96, data: { customName: item.name || "Prompt", text: item.text || "" } };
      selection = new Set([node.id]); command({ type: "addNode", node });
    },
    onUseTemplate: item => { command({ type: "insertGraph", graph: item.graph }); },
  });
  function centerCanvasAt(x, y, drawerWidth = canvasNavigation?.drawerWidth || 0) {
    pan.x = drawerWidth + (innerWidth - drawerWidth) / 2 - x * pan.zoom;
    pan.y = innerHeight / 2 - y * pan.zoom;
    transform();
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  }

  function finishPan() {
    if (drag?.mode !== "pan") return;
    if (drag.middle) suppressMiddlePasteUntil = Date.now() + 250;
    drag = null;
    shell.classList.remove("middle-panning");
    setPointerMode(panMode);
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  }
  const marquee = el("div", undefined, "cvn-selection-box");
  marquee.hidden = true;
  viewport.append(marquee);
  function finishSelection(cancel = false) {
    if (drag?.mode !== "select") return;
    if (cancel) selection = drag.previous;
    drag = null;
    marquee.hidden = true;
    renderContext();
  }
  function startMiddlePan(event) {
    event.preventDefault(); event.stopPropagation();
    suppressMiddlePasteUntil = Date.now() + 1000;
    if (drag?.mode === "pan" && drag.middle) return;
    finishSelection(true);
    if (drag?.mode === "node") { drag = null; refreshNodePositions(); }
    closeDockPopup(); rightMenu.close();
    drag = { mode: "pan", middle: true, startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y };
    shell.classList.add("middle-panning");
    select.dataset.mode = "temporary-hand";
    select.setAttribute("aria-label", "Bàn tay tạm thời · Chuột giữa");
    select.title = "Giữ chuột giữa để kéo Canvas";
    select.replaceChildren(icon("hand"), el("span", "●", "tool-mode-badge"));
    viewport.style.cursor = "grabbing";
    if (event.pointerId !== undefined) viewport.setPointerCapture(event.pointerId);
  }
  // Pointer events omit a second button press while another mouse button is down.
  // Keep native mouse events too, and capture above controls/media in the Canvas shell.
  window.addEventListener('paste', event => { if (Date.now() < suppressMiddlePasteUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, { capture:true, signal:abort.signal });
  window.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') suppressMiddlePasteUntil = 0; }, { capture:true, signal:abort.signal });
  shell.addEventListener("pointerdown", event => {
    if (event.button === 1) startMiddlePan(event);
  }, { capture: true, signal: abort.signal });
  shell.addEventListener("mousedown", event => {
    if (event.button === 1) startMiddlePan(event);
  }, { capture: true, signal: abort.signal });
  function moveMiddlePan(event) {
    if ((event.buttons & 4) && !drag?.middle && shell.contains(event.target)) startMiddlePan(event);
    if (drag?.mode !== "pan" || !drag.middle) return;
    event.preventDefault();
    if (!(event.buttons & 4)) { finishPan(); return; }
    pan.x = drag.x + event.clientX - drag.startX;
    pan.y = drag.y + event.clientY - drag.startY;
    transform();
  }
  window.addEventListener("pointermove", moveMiddlePan, { capture: true, signal: abort.signal });
  window.addEventListener("mousemove", moveMiddlePan, { capture: true, signal: abort.signal });
  window.addEventListener("mouseup", event => {
    if (event.button === 1 && drag?.middle) { event.preventDefault(); finishPan(); }
  }, { capture: true, signal: abort.signal });
  shell.addEventListener("auxclick", event => { if (event.button === 1) event.preventDefault(); }, { capture: true, signal: abort.signal });
  viewport.onpointerdown = (e) => {
    if (e.button !== 0 || e.target.closest(".cvn-image-toolbar")) return;
    if (e.target.closest(".cvn-node") && !panMode) return;
    pendingLink = null;
    for (const menu of stage.querySelectorAll(".port-menu")) menu.remove();
    if (!panMode) {
      const previous = new Set(selection);
      if (!e.shiftKey) selection.clear();
      drag = { mode: "select", startX: e.clientX, startY: e.clientY, previous, base: new Set(selection) };
      renderContext();
      e.preventDefault();
      viewport.setPointerCapture(e.pointerId);
      return;
    }
    drag = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      x: pan.x,
      y: pan.y,
    };
    viewport.setPointerCapture(e.pointerId);
  };
  viewport.onpointermove = (e) => {
    if (drag?.mode === "select") {
      const left = Math.min(drag.startX, e.clientX), top = Math.min(drag.startY, e.clientY),
        right = Math.max(drag.startX, e.clientX), bottom = Math.max(drag.startY, e.clientY);
      if (Math.hypot(right - left, bottom - top) < 3) return;
      marquee.hidden = false;
      Object.assign(marquee.style, { left: left + "px", top: top + "px", width: right - left + "px", height: bottom - top + "px" });
      selection = new Set(drag.base);
      for (const card of stage.querySelectorAll(".cvn-node")) {
        const rect = card.querySelector(".cvn-node-body").getBoundingClientRect();
        if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) selection.add(card.dataset.id);
      }
      renderContext();
      return;
    }
    if (drag?.mode !== "pan") return;
    pan.x = drag.x + e.clientX - drag.startX;
    pan.y = drag.y + e.clientY - drag.startY;
    transform();
  };
  viewport.onpointerup = event => {
    finishSelection();
    if (!drag?.middle || !(event.buttons & 4)) finishPan();
  };
  viewport.onpointercancel = () => { finishSelection(true); finishPan(); };
  window.addEventListener("blur", () => finishSelection(true), { signal: abort.signal });
  window.addEventListener("blur", finishPan, { signal: abort.signal });
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (drag?.middle) { e.preventDefault(); return; }
      if (e.target.closest('textarea,video,[contenteditable="true"],.inline-composer,.generation-options-panel,.cvn-image-toolbar')) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08,
        newZoom = Math.max(0.1, Math.min(4, pan.zoom * factor)),
        x = (e.clientX - pan.x) / pan.zoom,
        y = (e.clientY - pan.y) / pan.zoom;
      pan.x = e.clientX - x * newZoom;
      pan.y = e.clientY - y * newZoom;
      pan.zoom = newZoom;
      transform();
      clearTimeout(wheelSave);
      wheelSave = setTimeout(() => {
        controller.execute({ type: "setViewport", viewport: pan });
        void persist();
      }, 150);
    },
    { passive: false, signal: abort.signal },
  );
  viewport.ondragover = (e) => e.preventDefault();
  viewport.ondrop = async (e) => {
    e.preventDefault();
    try {
      for (const file of e.dataTransfer.files) {
        const a = await addAsset(file, { projectId: id });
        await addAssetNode(a);
      }
    } catch (e) {
      notice(e.message);
    }
  };
  function clearConnectionTargets() {
    for (const node of stage.querySelectorAll(".connection-drop-target")) node.classList.remove("connection-drop-target");
  }
  window.addEventListener("pointermove", (event) => {
    for (const node of stage.querySelectorAll(".cvn-node")) {
      const body = node.querySelector(".cvn-node-body"), rect = body.getBoundingClientRect();
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right),
        dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      node.classList.toggle("ports-visible", Math.hypot(dx, dy) < 44 || linkDrag?.id === node.dataset.id || pendingLink?.id === node.dataset.id);
    }
    if (!linkDrag) return;
    linkDrag.x = event.clientX;
    linkDrag.y = event.clientY;
    if (Math.hypot(event.clientX - linkDrag.startX, event.clientY - linkDrag.startY) > 4) linkDrag.moved = true;
    clearConnectionTargets();
    const target = document.elementFromPoint(event.clientX, event.clientY),
      node = target?.closest(".cvn-node"), port = target?.closest(".cvn-port");
    if (node && node.dataset.id !== linkDrag.id && (!port || port.dataset.side !== linkDrag.side)) node.classList.add("connection-drop-target");
    scheduleWires();
  }, { signal: abort.signal });
  window.addEventListener("pointerup", (event) => {
    if (!linkDrag) return;
    const start = linkDrag;
    linkDrag = null;
    clearConnectionTargets();
    if (start.moved) {
      suppressPortClickUntil = performance.now() + 250;
      const element = document.elementFromPoint(event.clientX, event.clientY),
        port = element?.closest(".cvn-port"),
        targetId = element?.closest(".cvn-node")?.dataset.id;
      if (targetId && targetId !== start.id && (!port || port.dataset.side !== start.side)) {
        pendingLink = null;
        try { connectNodes(start.side === "output" ? start.id : targetId, start.side === "input" ? start.id : targetId); }
        catch (e) { notice(e.message); }
      }
    }
    scheduleWires();
  }, { signal: abort.signal });
  window.addEventListener("pointercancel", () => { linkDrag = null; clearConnectionTargets(); scheduleWires(); }, { signal: abort.signal });
  window.addEventListener("resize", scheduleWires, { signal: abort.signal });
  window.addEventListener("resize", positionNativeMenus, { signal: abort.signal });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        pendingLink = null;
        linkDrag = null;
        clearConnectionTargets();
        closeDockPopup();
        if (activeInlinePopup) editor.close();
        rightMenu.close();
        for (const menu of stage.querySelectorAll(".port-menu")) menu.remove();
        scheduleWires();
      }
      if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        ["v", "h"].includes(e.key.toLowerCase())
      ) {
        setPointerMode(e.key.toLowerCase() === "h");
      }
      const selectedNode = controller.snapshot().nodes.find(node => selection.has(node.id));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedNode && !window.getSelection()?.toString()) {
        e.preventDefault();
        void copyNode(selectedNode).catch(error => notice(error.message));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedNode) {
        e.preventDefault();
        duplicateNode(selectedNode);
      }
      if (["Delete", "Backspace"].includes(e.key) && selectedNode) {
        e.preventDefault();
        command({ type: "deleteNode", id: selectedNode.id });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? controller.redo() : controller.undo();
        render();
        void persist();
      }
    },
    { signal: abort.signal },
  );
  window.addEventListener('mooz-job-update', event => applyJobOutput(event.detail), { signal: abort.signal });
  render();
  if (recoveredOutputs) await persist();
  const tabStatusTimer = setInterval(() => {
    void list("jobs").then(jobs => {
      if (disposed) return;
      busyTabIds = new Set(jobs.filter(job => ["preparing", "sent", "receiving"].includes(job.status)).map(job => job.tabId));
      for (const update of tabLabelRefreshers.values()) update();
    }).catch(() => {});
  }, 3000);
  return () => {
    disposed = true;
    clearTimeout(wheelSave);
    clearTimeout(inlineSave);
    clearInterval(tabStatusTimer);
    if (drawFrame) cancelAnimationFrame(drawFrame);
    abort.abort();
    shell.remove();
    editor.remove();
    for (const dialog of document.querySelectorAll(".image-workbench"))
      dialog.close();
    document.body.classList.remove("studio-mode");
    host.classList.remove("studio-host");
    for (const url of urls.values()) URL.revokeObjectURL(url);
    controller.execute({ type: "setViewport", viewport: pan });
    return persist();
  };
}
