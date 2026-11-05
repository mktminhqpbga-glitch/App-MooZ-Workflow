import { exportBundle } from "./core/backup.js";
import { editImage, captureFrame } from "./media-tools.js";
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
    currentJob = null,
    drag = null,
    drawFrame = null,
    wheelSave = null;
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
  top.append(cluster, status, backup, settings);
  shell.append(top);
  const dock = el("nav", undefined, "panel cvn-dock");
  dock.setAttribute("aria-label", "Công cụ canvas");
  const types = [
    ["prompt", "T"],
    ["imageInput", "▧"],
    ["videoInput", "▷"],
    ["generateImage", "Ảnh AI"],
    ["generateVideo", "Video AI"],
    ["generateText", "Văn bản AI"],
  ];
  for (const [type, label] of types) {
    const b = button(label, () => addNode(type));
    b.title = {
      prompt: "Thêm prompt",
      imageInput: "Thêm ảnh",
      videoInput: "Thêm video",
      generateImage: "Tạo ảnh",
      generateVideo: "Tạo video",
      generateText: "Tạo văn bản",
    }[type];
    b.setAttribute("aria-label", b.title);
    dock.append(b);
  }
  dock.append(
    button("↶", () => {
      controller.undo();
      render();
      persist();
    }),
    button("↷", () => {
      controller.redo();
      render();
      persist();
    }),
    button("Kho", () => showAssets()),
    button("Hàng đợi", () => showHistory()),
  );
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
  const editor = el("dialog", undefined, "cvn-composer");
  editor.setAttribute("aria-label", "Thiết lập node");
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
      width = Math.max(...nodes.map((n) => n.x + 340)) - x,
      height = Math.max(...nodes.map((n) => n.y + 330)) - y;
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
  async function addNode(type) {
    if (type === "imageInput" || type === "videoInput") {
      files.accept = type === "imageInput" ? "image/*" : "video/*";
      files.click();
      return;
    }
    const n = {
      id: crypto.randomUUID(),
      type,
      x: Math.max(-240, ...controller.snapshot().nodes.map((n) => n.x)) + 440,
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
    selection = new Set([n.id]);
    render();
    fit();
    openEditor(n.id);
  }
  async function addAssetNode(a) {
    const n = {
      id: crypto.randomUUID(),
      type: a.kind === "video" ? "videoInput" : "imageInput",
      x: Math.max(-300, ...controller.snapshot().nodes.map((n) => n.x)) + 440,
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
        body.append(
          el("p", n.data.text),
          button("Thiết lập", () => openEditor(n.id)),
        );
      } else {
        body.append(
          el("span", n.type === "preview" ? "▷" : "✧", "cvn-empty-symbol"),
          el("p", n.data.studioPrompt || "Chọn để nhập yêu cầu và nối nguồn."),
        );
        body.append(button("Thiết lập", () => openEditor(n.id)));
      }
      if (!card.isConnected) stage.append(card);
      for (const side of ["input", "output"]) {
        const ports =
          nodeTypes[n.type][side === "input" ? "inputs" : "outputs"];
        if (Object.keys(ports).length) {
          const p = button("+", () => openEditor(n.id), "cvn-port " + side);
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
        if (e.target.closest("button,textarea,video,audio")) return;
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
        if (!e.target.closest("textarea,video,button")) openEditor(n.id);
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
      const x = a.offsetLeft + 340,
        y = a.offsetTop + Math.min(a.offsetHeight / 2, 150),
        tx = b.offsetLeft,
        ty = b.offsetTop + Math.min(b.offsetHeight / 2, 150),
        path = document.createElementNS(wires.namespaceURI, "path");
      path.setAttribute(
        "d",
        `M${x} ${y} C${x + 100} ${y},${tx - 100} ${ty},${tx} ${ty}`,
      );
      wires.append(path);
    }
  }
  function renderContext() {
    context.replaceChildren();
    const ids = [...selection];
    context.hidden = !ids.length;
    if (!ids.length) return;
    if (ids.length === 1) {
      const n = controller.snapshot().nodes.find((n) => n.id === ids[0]);
      if (n?.data.assetId) {
        context.append(
          button("Tải xuống", async () => {
            const a = await readAsset(n.data.assetId);
            if (!a) throw Error("Tài sản đã bị xóa.");
            const link = el("a");
            link.href = URL.createObjectURL(a.blob);
            link.download = a.name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }),
          button("Chỉnh media", async () => {
            const a = await readAsset(n.data.assetId);
            if (!a) throw Error("Tài sản đã bị xóa.");
            if (a.kind === "image")
              return editImage(a, (output) => {
                if (!disposed) void addAssetNode(output);
              });
            if (a.kind === "video") {
              const video = stage.querySelector(
                `[data-id="${CSS.escape(n.id)}"] video`,
              );
              const output = await captureFrame(a, video?.currentTime || 0);
              await addAssetNode(output);
            }
          }),
        );
      }
    }
    context.append(
      el("span", ids.length === 1 ? "Đối tượng đã chọn" : ids.length + " node"),
    );
    if (ids.length === 1)
      context.append(button("Thiết lập", () => openEditor(ids[0])));
    context.append(
      button("Nhân bản", () => {
        for (const id of ids) {
          const n = controller.snapshot().nodes.find((n) => n.id === id);
          command({
            type: "addNode",
            node: { ...n, id: crypto.randomUUID(), x: n.x + 50, y: n.y + 50 },
          });
        }
      }),
      button("Nhóm", () => command({ type: "group", ids })),
      button("Lưu luồng", async () => {
        await write("templates", {
          id: crypto.randomUUID(),
          name: project.name + " · Luồng",
          graph: templateGraph(),
          createdAt: new Date().toISOString(),
        });
        notice("Đã lưu vào Kho → Luồng mẫu");
      }),
      button("Xóa", () => {
        for (const id of ids) command({ type: "deleteNode", id });
        selection.clear();
        render();
      }),
    );
  }
  async function openEditor(id) {
    const n = controller.snapshot().nodes.find((n) => n.id === id);
    if (!n) return;
    editor.replaceChildren();
    editor.dataset.nodeId = id;
    const head = el("div", undefined, "section-head");
    head.append(
      el("strong", n.data.customName || n.type),
      button("×", () => editor.close()),
    );
    editor.append(head);
    const label = el("label", "Tên"),
      title = el("input");
    title.value = n.data.customName || n.type;
    title.onchange = () =>
      command({ type: "updateNode", id, patch: { customName: title.value } });
    label.append(title);
    editor.append(label);
    if (n.type === "prompt" || n.type.startsWith("generate")) {
      const text = el("textarea");
      text.setAttribute("aria-label", "Nội dung yêu cầu");
      text.placeholder = "Mô tả nội dung bạn muốn tạo…";
      text.value =
        n.type === "prompt" ? n.data.text || "" : n.data.studioPrompt || "";
      text.onchange = () =>
        command({
          type: "updateNode",
          id,
          patch: {
            [n.type === "prompt" ? "text" : "studioPrompt"]: text.value,
          },
        });
      editor.append(text);
      editor.append(
        button("Lưu prompt vào Kho", async () => {
          await write("prompts", {
            id: crypto.randomUUID(),
            name: title.value,
            text: text.value,
            createdAt: new Date().toISOString(),
          });
          notice("Đã lưu vào Kho → Prompt");
        }),
      );
    }
    if (n.type.startsWith("generate")) {
      const kind =
          n.type === "generateText"
            ? "text"
            : n.type === "generateImage"
              ? "image"
              : "video",
        provider = el("select"),
        tabs = el("select"),
        ratio = el("select"),
        duration = el("select");
      provider.setAttribute("aria-label", "AI thực hiện");
      tabs.setAttribute("aria-label", "Tab chạy luồng");
      for (const p of providerList.filter((p) => p.types.includes(kind)))
        provider.add(new Option(p.name, p.id));
      provider.value = n.data.provider || "muse";
      for (const r of ["16:9", "9:16", "1:1", "4:3", "3:4"])
        ratio.add(new Option(r, r));
      ratio.value = n.data.size || "16:9";
      for (const d of [5, 10, 15, 30, 40])
        duration.add(new Option(d + " giây", d));
      duration.value = String(n.data.duration || 5);
      duration.hidden = kind !== "video";
      ratio.onchange = () =>
        command({ type: "updateNode", id, patch: { size: ratio.value } });
      duration.onchange = () =>
        command({
          type: "updateNode",
          id,
          patch: { duration: Number(duration.value) },
        });
      async function refresh() {
        tabs.replaceChildren(new Option("Chọn tab AI…", ""));
        try {
          if (!["google", "openai"].includes(provider.value))
            for (const t of await api("tabs?provider=" + provider.value)) {
              const o = new Option(t.title || t.url, t.id);
              o.dataset.url = t.url;
              tabs.add(o);
            }
        } catch (e) {
          notice(e.message);
        }
      }
      provider.onchange = () => {
        command({
          type: "updateNode",
          id,
          patch: { provider: provider.value },
        });
        void refresh();
      };
      editor.append(
        provider,
        ratio,
        duration,
        tabs,
        button("Làm mới tab", refresh),
        button("Tạo kết quả ↑", async () => {
          await saving;
          const graph = controller.snapshot(),
            required = new Set([id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const e of graph.edges)
              if (required.has(e.target) && !required.has(e.source)) {
                required.add(e.source);
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
          const job = await createJob({
            projectId: project.id,
            graph: subset,
            provider: provider.value,
            tabId: tabs.value ? Number(tabs.value) : null,
            chatURL: tabs.selectedOptions[0]?.dataset.url || null,
            title: project.name,
          });
          currentJob = job.id;
          const result = await startJob(job.id, (j) => {
            status.textContent =
              {
                queued: "Chờ lượt",
                preparing: "Chuẩn bị",
                sent: "Đang chờ AI",
                receiving: "Đang nhận kết quả",
                success: "Hoàn tất",
                unknown: "Cần đối chiếu",
                error: "Có lỗi",
              }[j.status] || j.status;
          });
          if (result.status !== "success") {
            notice(result.error || "Tác vụ chưa hoàn tất.");
            return;
          }
          for (const [nodeId, output] of Object.entries(result.outputs))
            if (
              subset.nodes
                .find((n) => n.id === nodeId)
                ?.type.startsWith("generate")
            ) {
              if (output.assetId)
                command({
                  type: "updateNode",
                  id: nodeId,
                  patch: { assetId: output.assetId },
                });
              else if (output.text)
                command({
                  type: "updateNode",
                  id: nodeId,
                  patch: { text: output.text },
                });
            }
          notice("Đã nhận và lưu kết quả");
        }),
        button("Dừng", () => currentJob && stopJob(currentJob)),
      );
      void refresh();
    }
    const graph = controller.snapshot(),
      sources = el("select"),
      inputs = el("select");
    sources.setAttribute("aria-label", "Nguồn nối");
    inputs.setAttribute("aria-label", "Cổng đầu vào");
    for (const source of graph.nodes.filter((s) => s.id !== id))
      for (const port of Object.keys(nodeTypes[source.type].outputs))
        sources.add(
          new Option(
            (source.data.customName || source.type) + " · " + port,
            source.id + "|" + port,
          ),
        );
    for (const port of Object.keys(nodeTypes[n.type].inputs))
      inputs.add(new Option(port, port));
    if (inputs.options.length) {
      editor.append(
        el("small", "Nguồn tham chiếu và dây nối"),
        sources,
        inputs,
        button("Nối nguồn", () => {
          const [source, sourcePort] = sources.value.split("|");
          command({
            type: "connect",
            edge: {
              id: crypto.randomUUID(),
              source,
              sourcePort,
              target: id,
              targetPort: inputs.value,
            },
          });
          openEditor(id);
        }),
      );
      for (const edge of graph.edges.filter((e) => e.target === id))
        editor.append(
          button(
            "Bỏ dây: " +
              (graph.nodes.find((n) => n.id === edge.source)?.data.customName ||
                edge.sourcePort),
            () => {
              command({ type: "disconnect", id: edge.id });
              openEditor(id);
            },
          ),
        );
    }
    if (!editor.open) editor.show();
    const target = stage.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (target && innerWidth > 800) {
      const r = target.getBoundingClientRect(),
        width = Math.min(720, innerWidth - 32),
        height = editor.offsetHeight;
      editor.style.bottom = "auto";
      editor.style.transform = "none";
      editor.style.left =
        Math.max(
          16,
          Math.min(innerWidth - width - 16, r.left + r.width / 2 - width / 2),
        ) + "px";
      editor.style.top =
        Math.max(80, Math.min(innerHeight - height - 90, r.bottom + 20)) + "px";
    }
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
    if (e.target.closest(".cvn-node")) return;
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
