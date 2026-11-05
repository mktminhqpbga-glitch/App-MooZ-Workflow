// Portable graph contract: no DOM, Electron or provider access.
const dataNodeTypes = {
  prompt: { inputs: {}, outputs: { text: "text" } },
  imageInput: { inputs: {}, outputs: { image: "image" } },
  videoInput: { inputs: {}, outputs: { video: "video" } },
  audioInput: { inputs: {}, outputs: { audio: "audio" } },
  negativePrompt: { inputs: {}, outputs: { text: "text" } },
  generateText: { inputs: { prompt: "text", reference: "image", negative: "text" }, outputs: { text: "text" } },
  generateImage: {
    inputs: { prompt: "text", reference: "image", video: "video", negative: "text" },
    outputs: { image: "image" },
  },
  generateVideo: {
    inputs: { prompt: "text", reference: "image", video: "video", negative: "text" },
    outputs: { video: "video" },
  },
  preview: { inputs: { media: "media" }, outputs: {} },
  captureLastFrame: { inputs: { video: "video" }, outputs: { image: "image" } },
  assembleVideo: { inputs: { videos: "video", audio: "audio" }, outputs: { video: "video" } },
  ...Object.fromEntries(['videoTrim','videoRotate','videoColor','frameFit','audioMix','subtitles','voiceSync','transition','speed','watermark'].map(type => [type, { inputs: { video: "video", audio: "audio", text: "text", reference: "image" }, outputs: { video: "video" } }])),
  audioExtract: { inputs: { video: "video" }, outputs: { audio: "audio" } },
  voiceover: { inputs: { text: "text" }, outputs: { audio: "audio" } },
  transcribe: { inputs: { media: "media" }, outputs: { text: "text" } },
};
// Every node can participate in workflow ordering; native data ports keep their types.
export const nodeTypes = Object.freeze(Object.fromEntries(
  Object.entries(dataNodeTypes).map(([name, definition]) => [name, {
    inputs: { ...definition.inputs, workflow: "flow" },
    outputs: { ...definition.outputs, workflow: "flow" },
  }]),
));
const allowed = [
  "customName",
  "text",
  "studioPrompt",
  "provider",
  "size",
  "duration",
  "assetId",
  "expectedKind",
  "stylePrompt",
  "cameraPrompt",
  "cameraBody",
  "cameraLens",
  "cameraFocal",
  "cameraAperture",
  "cameraEnabled",
  "motionPrompt",
  "effectPrompt",
  "quality",
  "resolution",
  "background",
  "count",
  "resultAssets",
  "referenceOrder",
  "rating",
  "outputKey",
  "localSettings", "captions", "sceneIndex", "sceneCount", "referenceRoles", "negativePrompt",
];
export const emptyGraph = () => ({
  nodes: [],
  edges: [],
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
function id(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
export function validateGraph(value) {
  if (
    !value ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.groups)
  )
    throw Error("Cấu trúc graph không hợp lệ.");
  if (
    value.nodes.length > 1000 ||
    value.edges.length > 5000 ||
    value.groups.length > 1000
  )
    throw Error("Dự án vượt giới hạn graph.");
  const nodes = [],
    ids = new Set();
  for (const n of value.nodes) {
    if (
      !id(n.id) ||
      ids.has(n.id) ||
      !Object.hasOwn(nodeTypes, n.type) ||
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y)
    )
      throw Error("Node không hợp lệ hoặc trùng ID.");
    ids.add(n.id);
    const data = {};
    if (!n.data || typeof n.data !== "object" || Array.isArray(n.data))
      throw Error("Dữ liệu node không hợp lệ.");
    for (const key of allowed) {
      if (!Object.hasOwn(n.data, key)) continue;
      const v = n.data[key];
      if (["sceneIndex", "sceneCount"].includes(key)) {
        if (!Number.isInteger(v) || v < 1 || v > 12) throw Error("Chỉ hỗ trợ 1–12 cảnh.");
      } else if (["localSettings", "referenceRoles"].includes(key)) {
        if (typeof v !== 'string' || v.length > 50000) throw Error('Thông số local không hợp lệ.');
        let parsed; try { parsed = JSON.parse(v); } catch { throw Error('Thông số local cần JSON hợp lệ.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Thông số local cần một đối tượng.');
      } else if (["resultAssets", "referenceOrder"].includes(key)) {
        let ids;
        try {
          ids = JSON.parse(v);
        } catch {
          throw Error("Danh sách kết quả không hợp lệ.");
        }
        if (!Array.isArray(ids) || ids.length > 20 || ids.some((i) => !id(i)))
          throw Error("Danh sách kết quả không hợp lệ.");
      } else if (key === "count") {
        if (![1, 2, 4].includes(v)) throw Error("Số ảnh cần là 1, 2 hoặc 4.");
      } else if (key === "rating") {
        if (!Number.isInteger(v) || v < 0 || v > 5) throw Error("Đánh giá cần từ 0 đến 5 sao.");
      } else if (key === "quality") {
        if (!["low", "medium", "high", "ultra", "max"].includes(v))
          throw Error("Chất lượng không hợp lệ.");
      } else if (key === "resolution") {
        if (!["1K", "2K", "4K", "480P", "720P", "1080P"].includes(v))
          throw Error("Độ phân giải không hợp lệ.");
      } else if (key === "background") {
        if (!["auto", "preserve", "transparent"].includes(v))
          throw Error("Nền ảnh không hợp lệ.");
      } else if (key === "duration") {
        if (v !== null && (!Number.isInteger(v) || v < 1 || v > 120))
          throw Error("Thời lượng không hợp lệ.");
      } else if (typeof v !== "string" || v.length > 50000)
        throw Error("Dữ liệu node không hợp lệ.");
      data[key] = v;
    }
    nodes.push({ id: n.id, type: n.type, x: n.x, y: n.y, data });
  }
  const edges = [],
    edgeIds = new Set(),
    byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of value.edges) {
    if (!id(e.id) || edgeIds.has(e.id))
      throw Error("Dây nối không hợp lệ hoặc trùng ID.");
    const s = byId.get(e.source),
      t = byId.get(e.target),
      out = s && nodeTypes[s.type].outputs[e.sourcePort],
      input = t && nodeTypes[t.type].inputs[e.targetPort];
    if (
      !out ||
      !input ||
      s.id === t.id ||
      !(
        out === input ||
        (input === "media" &&
          ["image", "video", "audio", "media"].includes(out))
      )
    )
      throw Error("Cổng nối không tương thích.");
    if (
      edges.some(
        (old) =>
          old.source === e.source &&
          old.target === e.target &&
          old.sourcePort === e.sourcePort &&
          old.targetPort === e.targetPort,
      )
    )
      throw Error("Dây nối đã tồn tại.");
    if (
      !["reference", "workflow", "videos"].includes(e.targetPort) &&
      !(e.targetPort === 'video' && ['transition','voiceSync'].includes(t.type)) &&
      !(e.targetPort === 'audio' && t.type === 'voiceSync') &&
      edges.some(
        (old) => old.target === e.target && old.targetPort === e.targetPort,
      )
    )
      throw Error("Cổng này chỉ nhận một nguồn.");
    edgeIds.add(e.id);
    edges.push({
      id: e.id,
      source: e.source,
      sourcePort: e.sourcePort,
      target: e.target,
      targetPort: e.targetPort,
    });
  }
  const groups = [],
    groupIds = new Set();
  for (const g of value.groups) {
    if (
      !id(g.id) ||
      groupIds.has(g.id) ||
      typeof g.name !== "string" ||
      g.name.length > 120 ||
      !Array.isArray(g.nodeIds) ||
      !g.nodeIds.length ||
      g.nodeIds.some((n) => !ids.has(n)) ||
      new Set(g.nodeIds).size !== g.nodeIds.length
    )
      throw Error("Nhóm node không hợp lệ.");
    groupIds.add(g.id);
    groups.push({ id: g.id, name: g.name, nodeIds: [...g.nodeIds] });
  }
  const viewport = value.viewport || { x: 0, y: 0, zoom: 1 };
  if (
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom < 0.1 ||
    viewport.zoom > 4
  )
    throw Error("Vùng nhìn không hợp lệ.");
  const graph = {
    nodes,
    edges,
    groups,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  };
  topologicalOrder(graph);
  return graph;
}
export function topologicalOrder(graph) {
  const counts = new Map(graph.nodes.map((n) => [n.id, 0])),
    out = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    if (!counts.has(e.source) || !counts.has(e.target))
      throw Error("Dây nối trỏ tới node không tồn tại.");
    counts.set(e.target, counts.get(e.target) + 1);
    out.get(e.source).push(e.target);
  }
  const queue = [...counts].filter(([, n]) => n === 0).map(([id]) => id),
    order = [];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    order.push(current);
    for (const next of out.get(current)) {
      counts.set(next, counts.get(next) - 1);
      if (counts.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) throw Error("Dây nối tạo vòng lặp.");
  return order;
}
export class GraphController {
  #graph;
  #undo = [];
  #redo = [];
  constructor(graph = emptyGraph()) {
    this.#graph = validateGraph(graph);
  }
  snapshot() {
    return structuredClone(this.#graph);
  }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  execute(command) {
    const next = this.snapshot();
    if (command.type === "addNode")
      next.nodes.push(structuredClone(command.node));
    else if (command.type === "connect")
      next.edges.push(structuredClone(command.edge));
    else if (command.type === "updateNode") {
      const node = next.nodes.find((n) => n.id === command.id);
      if (!node) throw Error("Không tìm thấy node.");
      Object.assign(node.data, command.patch);
    } else if (command.type === "insertGraph") {
      const incoming = validateGraph(command.graph),
        map = new Map(incoming.nodes.map((n) => [n.id, crypto.randomUUID()]));
      for (const n of incoming.nodes)
        next.nodes.push({
          ...n,
          id: map.get(n.id),
          x: n.x + 100,
          y: n.y + 100,
        });
      for (const e of incoming.edges)
        next.edges.push({
          ...e,
          id: crypto.randomUUID(),
          source: map.get(e.source),
          target: map.get(e.target),
        });
      for (const g of incoming.groups)
        next.groups.push({
          ...g,
          id: crypto.randomUUID(),
          nodeIds: g.nodeIds.map((id) => map.get(id)),
        });
    } else if (command.type === 'reorderInputs') {
      const edges = next.edges.filter(edge => edge.target === command.target && edge.targetPort === command.port);
      if (!Array.isArray(command.edgeIds) || command.edgeIds.length !== edges.length || new Set(command.edgeIds).size !== edges.length || command.edgeIds.some(id => !edges.some(edge => edge.id === id))) throw Error('Thứ tự đầu vào không hợp lệ.');
      const position = next.edges.findIndex(edge => edges.some(item => item.id === edge.id));
      next.edges = next.edges.filter(edge => !edges.some(item => item.id === edge.id));
      next.edges.splice(Math.max(0,position),0,...command.edgeIds.map(id => edges.find(edge => edge.id === id)));
    } else if (command.type === "moveNodes") {
      for (const move of command.moves) {
        const n = next.nodes.find((n) => n.id === move.id);
        if (!n) throw Error("Không tìm thấy node.");
        n.x = move.x;
        n.y = move.y;
      }
    } else if (command.type === "moveNode") {
      const n = next.nodes.find((n) => n.id === command.id);
      if (!n) throw Error("Không tìm thấy node.");
      n.x = command.x;
      n.y = command.y;
    } else if (command.type === "group") {
      next.groups.push({
        id: crypto.randomUUID(),
        name: String(command.name || "Nhóm").slice(0, 120),
        nodeIds: [...new Set(command.ids)],
      });
    } else if (command.type === "ungroup") {
      next.groups = next.groups.filter((g) => g.id !== command.id);
    } else if (command.type === "setViewport") {
      next.viewport = command.viewport;
    } else if (command.type === "disconnect") {
      next.edges = next.edges.filter((e) => e.id !== command.id);
    } else if (command.type === "deleteNode") {
      if (!next.nodes.some((n) => n.id === command.id))
        throw Error("Không tìm thấy node.");
      next.nodes = next.nodes.filter((n) => n.id !== command.id);
      next.edges = next.edges.filter(
        (e) => e.source !== command.id && e.target !== command.id,
      );
      next.groups = next.groups
        .map((g) => ({
          ...g,
          nodeIds: g.nodeIds.filter((id) => id !== command.id),
        }))
        .filter((g) => g.nodeIds.length);
    } else throw Error("Lệnh graph chưa được hỗ trợ.");
    const valid = validateGraph(next);
    this.#undo.push(this.#graph);
    if (this.#undo.length > 50) this.#undo.shift();
    this.#redo = [];
    this.#graph = valid;
    return this.snapshot();
  }
  undo() {
    if (this.#undo.length) {
      this.#redo.push(this.#graph);
      this.#graph = this.#undo.pop();
    }
    return this.snapshot();
  }
  redo() {
    if (this.#redo.length) {
      this.#undo.push(this.#graph);
      this.#graph = this.#redo.pop();
    }
    return this.snapshot();
  }
}
