import { exportBundle } from "./core/backup.js";
import { ProjectRepository, createProject } from "./core/projects.js";
import { GraphController, nodeTypes } from "./core/graph.js";
import {
  addAsset,
  readAsset,
  listAssets,
  write,
  list,
} from "./core/storage.js";
import { createJob, startJob, stopJob } from "./core/runner.js";
import { api, providerList, el, button, notice } from "./client-api.js";
const repo = new ProjectRepository();
export async function mountStudio(host, id) {
  if (!id) {
    host.innerHTML =
      '<a class="back" href="#home">← Về tổng quan</a><h1>Canvas</h1><p class="intro">Mở dự án hoặc tạo một không gian mới.</p>';
    const actions = el("div", undefined, "project-actions");
    actions.append(
      button("＋ Dự án mới", async () => {
        const p = await repo.save(createProject("Canvas mới"), {
          create: true,
        });
        location.hash = "canvas/" + p.id;
      }),
    );
    host.append(actions);
    for (const p of await repo.list()) {
      const a = el("a", p.name, "project-card");
      a.href = "#canvas/" + p.id;
      host.append(a);
    }
    return () => {};
  }
  let project = await repo.get(id);
  if (!host.isConnected) return () => {};
  if (!project) {
    host.textContent = "Không tìm thấy dự án.";
    return () => {};
  }
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
  const bindings = new Map(),
    activeJobs = new Map();
  let panMode = false;
  document.body.classList.add("studio-mode");
  host.classList.add("studio-host");
  host.replaceChildren();
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
  for (const [type, label] of [
    ["generateImage", "Ảnh"],
    ["generateVideo", "Video"],
    ["prompt", "Văn bản"],
    ["generateText", "Tạo văn bản"],
    ["imageInput", "Tải ảnh"],
    ["videoInput", "Tải video"],
  ])
    addOptions.append(
      button(label, async () => {
        addMenu.open = false;
        await addNode(type);
      }),
    );
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
  dock.append(
    addMenu,
    select,
    button("▧", showAssets),
    button("◷", showHistory),
  );
  dock.children[2].setAttribute("aria-label", "Kho");
  dock.children[3].setAttribute("aria-label", "Hàng đợi");
  dock.children[2].innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7l2 3h9v13H3z"/></svg>';
  dock.children[3].innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>';
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
  const context = el("div", undefined, "panel cvn-context");
  context.hidden = true;
  shell.append(context);
  const files = el("input");
  files.type = "file";
  files.multiple = true;
  files.hidden = true;
  files.accept = "image/*,video/*";
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
  host.append(shell);
  const editor = el("dialog", undefined, "cvn-resource-sheet");
  editor.setAttribute("aria-label", "Tài nguyên dự án");
  document.body.append(editor);
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
    render();
    void persist();
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
    const x = Math.min(...nodes.map((n) => n.x)),
      y = Math.min(...nodes.map((n) => n.y)),
      width =
        Math.max(
          ...nodes.map(
            (n) =>
              n.x +
              (stage.querySelector(`[data-id="${CSS.escape(n.id)}"]`)
                ?.offsetWidth || 340),
          ),
        ) - x,
      height =
        Math.max(
          ...nodes.map(
            (n) =>
              n.y +
              (stage.querySelector(`[data-id="${CSS.escape(n.id)}"]`)
                ?.offsetHeight || 330),
          ),
        ) - y;
    pan.zoom = Math.max(
      0.1,
      Math.min(1, (innerWidth - 140) / width, (innerHeight - 230) / height),
    );
    pan.x = (innerWidth - width * pan.zoom) / 2 - x * pan.zoom;
    pan.y = 170 - y * pan.zoom;
    transform();
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  }
  async function addNode(type, sourceId = null) {
    if (type === "imageInput" || type === "videoInput") {
      files.accept = type === "imageInput" ? "image/*" : "video/*";
      files.click();
      return;
    }
    const n = {
      id: crypto.randomUUID(),
      type,
      x: Math.max(-240, ...controller.snapshot().nodes.map((n) => n.x)) + 660,
      y: 160,
      data: {
        customName: {
          prompt: "Prompt",
          generateImage: "Tạo ảnh",
          generateVideo: "Tạo video",
          generateText: "Tạo văn bản",
        }[type],
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
    fit();
    openEditor(n.id);
  }
  async function addAssetNode(a) {
    const n = {
      id: crypto.randomUUID(),
      type: a.kind === "video" ? "videoInput" : "imageInput",
      x: Math.max(-300, ...controller.snapshot().nodes.map((n) => n.x)) + 660,
      y: 160,
      data: { customName: a.name, assetId: a.id },
    };
    command({ type: "addNode", node: n });
    selection = new Set([n.id]);
    render();
    fit();
  }
  async function assetView(assetId, container) {
    try {
      const a = await readAsset(assetId);
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
    } catch (e) {
      notice(e.message);
    }
  }
  function render() {
    const graph = controller.snapshot();
    for (const old of stage.querySelectorAll(".cvn-node,.cvn-group"))
      old.remove();
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
      stage.append(box);
    }
    for (const n of graph.nodes) {
      const card = el(
          "article",
          undefined,
          "cvn-node " + (selection.has(n.id) ? "selected " : ""),
        ),
        title = el("div", n.data.customName || n.type, "cvn-node-title"),
        body = el("div", undefined, "cvn-node-body");
      card.dataset.id = n.id;
      Object.assign(card.style, { left: n.x + "px", top: n.y + "px" });
      card.append(title, body);
      if (n.data.assetId) {
        stage.append(card);
        void assetView(n.data.assetId, body);
      } else if (n.type === "prompt") {
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
      } else if (n.type === "generateText" && n.data.text) {
        body.append(el("p", n.data.text));
      } else {
        body.append(
          el(
            "span",
            n.type === "generateVideo" ? "▷" : "▧",
            "cvn-empty-symbol",
          ),
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
              if (side === "input" && n.type.startsWith("generate")) {
                card
                  .querySelector(".inline-tools button:nth-child(2)")
                  ?.click();
              } else {
                const old = card.querySelector(".port-menu");
                if (old) {
                  old.remove();
                  return;
                }
                const menu = el("div", undefined, "port-menu");
                for (const [type, label] of [
                  ["generateImage", "Tạo ảnh"],
                  ["generateVideo", "Tạo video"],
                ]) {
                  const accepted = Object.values(nodeTypes[type].inputs);
                  if (
                    Object.values(nodeTypes[n.type].outputs).some((output) =>
                      accepted.includes(output),
                    )
                  )
                    menu.append(button(label, () => addNode(type, n.id)));
                }
                card.append(menu);
              }
            },
            "cvn-port " + side,
          );
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
        if (panMode) return;
        if (
          e.target.closest(
            "button,textarea,video,audio,input,select,summary,.inline-composer",
          )
        )
          return;
        if (e.shiftKey) {
          selection.has(n.id) ? selection.delete(n.id) : selection.add(n.id);
        } else if (!selection.has(n.id)) selection = new Set([n.id]);
        for (const c of stage.querySelectorAll(".cvn-node"))
          c.classList.toggle("selected", selection.has(c.dataset.id));
        renderContext();
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
        drag.nx = drag.x + (e.clientX - drag.startX) / pan.zoom;
        drag.ny = drag.y + (e.clientY - drag.startY) / pan.zoom;
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
        render();
      };
      card.ondblclick = (e) => {
        if (!e.target.closest("textarea,video,button,input,select,summary"))
          openEditor(n.id);
      };
    }
    renderContext();
    drawWires();
    transform();
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
        drawWires();
      });
  }
  function drawWires() {
    wires.replaceChildren();
    const graph = controller.snapshot();
    for (const e of graph.edges) {
      const a = stage.querySelector(`[data-id="${CSS.escape(e.source)}"]`),
        b = stage.querySelector(`[data-id="${CSS.escape(e.target)}"]`);
      if (!a || !b) continue;
      const x = a.offsetLeft + a.offsetWidth,
        y =
          a.offsetTop +
          (a.querySelector(".cvn-node-body")?.offsetHeight || 240) / 2,
        tx = b.offsetLeft,
        ty =
          b.offsetTop +
          (b.querySelector(".cvn-node-body")?.offsetHeight || 240) / 2,
        path = document.createElementNS(wires.namespaceURI, "path");
      path.setAttribute(
        "d",
        `M${x} ${y} C${x + 100} ${y},${tx - 100} ${ty},${tx} ${ty}`,
      );
      wires.append(path);
    }
  }
  function renderContext() {
    context.hidden = true;
    context.replaceChildren();
  }
  function updateInline(id, patch) {
    if (failed)
      throw Error("Dự án có xung đột. Hãy sao lưu trước khi tải lại.");
    controller.execute({ type: "updateNode", id, patch });
    clearTimeout(inlineSave);
    inlineSave = setTimeout(() => void persist(), 180);
  }
  function openEditor(id) {
    const card = stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
    card?.querySelector("textarea")?.focus({ preventScroll: true });
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
    composer.setAttribute(
      "aria-label",
      "Prompt " + (n.data.customName || n.type),
    );
    const tools = el("div", undefined, "inline-tools"),
      refs = el("div", undefined, "inline-refs"),
      chooser = el("section", undefined, "inline-chooser");
    chooser.hidden = true;
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
        if (!chooser.hidden) fillChooser();
      }),
      upload,
    );
    const text = el("textarea");
    text.value = n.data.studioPrompt || "";
    text.placeholder =
      kind === "video"
        ? "Mô tả chuyển động, cảnh quay và nội dung video…"
        : "Mô tả hình ảnh bạn muốn tạo…";
    text.setAttribute("aria-label", "Nội dung yêu cầu");
    text.maxLength = 50000;
    text.oninput = () => updateInline(id, { studioPrompt: text.value });
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
    provider.setAttribute("aria-label", "AI thực hiện");
    for (const p of providerList.filter((p) => p.types.includes(kind)))
      provider.add(new Option(p.name, p.id));
    provider.value = n.data.provider || "muse";
    ratio.setAttribute("aria-label", "Tỷ lệ");
    for (const r of ["16:9", "9:16", "1:1", "4:3", "3:4"])
      ratio.add(new Option(r, r));
    ratio.value = n.data.size || "16:9";
    duration.setAttribute("aria-label", "Thời lượng");
    for (const d of [5, 10, 15, 30, 40])
      duration.add(new Option(d + " giây", d));
    duration.value = String(n.data.duration || 5);
    duration.hidden = kind !== "video";
    const refreshSummary = () =>
      (summary.textContent =
        ratio.value +
        (kind === "video" ? " · " + duration.value + "s" : "") +
        " ⌄");
    refreshSummary();
    ratio.onchange = () => {
      updateInline(id, { size: ratio.value });
      refreshSummary();
    };
    duration.onchange = () => {
      updateInline(id, { duration: Number(duration.value) });
      refreshSummary();
    };
    settingsBody.append(ratio, duration);
    settings.append(summary, settingsBody);
    settings.hidden = kind === "text";
    tabs.setAttribute("aria-label", "Tab chạy luồng");
    tabs.add(new Option("Chọn tab AI…", ""));
    connection.append(
      tabSummary,
      tabs,
      button("↻", () => refreshTabs()),
    );
    const binding = bindings.get(id);
    if (binding?.provider === provider.value) {
      const o = new Option(binding.title, binding.id);
      o.dataset.url = binding.url;
      tabs.add(o);
      tabs.value = String(binding.id);
      tabSummary.textContent = binding.title;
    }
    let tabRevision = 0;
    async function refreshTabs() {
      const seq = ++tabRevision,
        value = provider.value;
      tabs.disabled = true;
      try {
        const available = await api("tabs?provider=" + value);
        if (!composer.isConnected || seq !== tabRevision) return;
        tabs.replaceChildren(new Option("Chọn tab AI…", ""));
        for (const t of available) {
          const o = new Option(t.title || t.url, t.id);
          o.dataset.url = t.url;
          tabs.add(o);
        }
        const saved = bindings.get(id);
        if (saved?.provider === value) {
          if (!available.some((t) => t.id === saved.id)) {
            const offline = new Option("Tab đã chọn · ngoại tuyến", saved.id);
            offline.dataset.url = saved.url;
            offline.disabled = true;
            tabs.add(offline);
          }
          tabs.value = String(saved.id);
        }
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
          title: o.textContent,
          provider: provider.value,
        });
      else bindings.delete(id);
      tabSummary.textContent = o?.textContent || "Tab AI";
    };
    provider.onchange = () => {
      updateInline(id, { provider: provider.value });
      bindings.delete(id);
      tabs.replaceChildren(new Option("Chọn tab AI…", ""));
      tabSummary.textContent = "Tab AI";
      connection.hidden = ["openai", "google"].includes(provider.value);
      if (!connection.hidden && connection.open) void refreshTabs();
    };
    connection.hidden = ["openai", "google"].includes(provider.value);
    const send = button(
      "↑",
      async () => {
        if (activeJobs.has(id)) return stopJob(activeJobs.get(id));
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
          activeJobs.delete(id);
          await persist();
          render();
        } finally {
          activeJobs.delete(id);
          send.textContent = "↑";
          send.setAttribute(
            "aria-label",
            kind === "video" ? "Tạo video" : "Tạo ảnh",
          );
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
    footer.append(provider, settings, connection, send);
    composer.append(tools, refs, chooser, text, footer, hint);
    const incoming = controller.snapshot().edges.filter((e) => e.target === id);
    for (const edge of incoming) {
      const source = controller
        .snapshot()
        .nodes.find((n) => n.id === edge.source);
      const chip = button(
        source?.data.customName || "Nguồn",
        () => {
          chooser.hidden = false;
          fillChooser();
        },
        "inline-ref",
      );
      if (source?.data.assetId) {
        chip.textContent = "";
        const preview = el("span");
        chip.append(preview);
        void (async () => {
          const asset = await readAsset(source.data.assetId);
          if (asset?.kind === "image" && preview.isConnected) {
            let url = urls.get(asset.id);
            if (!url) {
              url = URL.createObjectURL(asset.blob);
              urls.set(asset.id, url);
            }
            const img = el("img");
            img.src = url;
            img.alt = asset.name;
            preview.append(img);
          }
        })();
      }
      refs.append(chip);
    }
    function fillChooser() {
      chooser.replaceChildren();
      const graph = controller.snapshot();
      for (const source of graph.nodes.filter((s) => s.id !== id))
        for (const [port, type] of Object.entries(
          nodeTypes[source.type].outputs,
        )) {
          const target = Object.entries(nodeTypes[n.type].inputs).find(
            ([, t]) => t === type,
          );
          if (!target) continue;
          const exists = graph.edges.find(
            (e) =>
              e.source === source.id &&
              e.sourcePort === port &&
              e.target === id &&
              e.targetPort === target[0],
          );
          chooser.append(
            button(
              (exists ? "✓ " : "＋ ") + (source.data.customName || source.type),
              () => {
                if (exists) command({ type: "disconnect", id: exists.id });
                else
                  command({
                    type: "connect",
                    edge: {
                      id: crypto.randomUUID(),
                      source: source.id,
                      sourcePort: port,
                      target: id,
                      targetPort: target[0],
                    },
                  });
              },
            ),
          );
        }
      if (!chooser.childNodes.length)
        chooser.append(
          el("p", "Thêm ảnh hoặc văn bản vào canvas để dùng làm nguồn."),
        );
    }
    return composer;
  }
  function templateGraph() {
    const graph = controller.snapshot();
    for (const n of graph.nodes)
      if (n.type.startsWith("generate") || n.type === "preview") {
        delete n.data.assetId;
        if (n.type === "generateText") delete n.data.text;
      }
    return graph;
  }
  async function showHistory() {
    editor.replaceChildren(
      el("h2", "Tác vụ của dự án"),
      button("Đóng", () => editor.close()),
      button("Làm mới", showHistory),
    );
    for (const j of (await list("jobs")).filter((j) => j.projectId === id)) {
      editor.append(
        el(
          "p",
          j.title +
            " · " +
            {
              success: "Hoàn tất",
              sent: "Chờ AI",
              queued: "Chờ lượt",
              unknown: "Cần đối chiếu",
              error: "Lỗi",
              review: "Đã thu hồi kết quả",
              stopped: "Đã dừng",
            }[j.status],
        ),
      );
      if (j.error) editor.append(el("small", j.error));
    }
    if (!editor.open) editor.show();
  }
  async function showAssets() {
    editor.replaceChildren();
    editor.append(
      button("Đóng", () => editor.close()),
      el("h2", "Kho tài nguyên"),
    );
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
              fit();
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

  viewport.onpointerdown = (e) => {
    if (e.target.closest(".cvn-node") && !panMode) return;
    selection.clear();
    renderContext();
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
    if (drag?.mode !== "pan") return;
    pan.x = drag.x + e.clientX - drag.startX;
    pan.y = drag.y + e.clientY - drag.startY;
    transform();
  };
  viewport.onpointerup = () => {
    if (drag?.mode === "pan") {
      drag = null;
      controller.execute({ type: "setViewport", viewport: pan });
      void persist();
    }
  };
  viewport.addEventListener(
    "wheel",
    (e) => {
      if (e.target.closest("textarea,video")) return;
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
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.target.closest("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? controller.redo() : controller.undo();
        render();
        void persist();
      }
    },
    { signal: abort.signal },
  );
  render();
  return () => {
    disposed = true;
    clearTimeout(wheelSave);
    clearTimeout(inlineSave);
    if (drawFrame) cancelAnimationFrame(drawFrame);
    abort.abort();
    editor.remove();
    document.body.classList.remove("studio-mode");
    host.classList.remove("studio-host");
    for (const url of urls.values()) URL.revokeObjectURL(url);
    controller.execute({ type: "setViewport", viewport: pan });
    void persist();
  };
}
