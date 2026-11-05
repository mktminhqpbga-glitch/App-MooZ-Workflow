import { createProject, exportProject } from "./projects.js";
import { readAsset, toDataURL, addAsset, remove } from "./storage.js";
import { validateGraph } from "./graph.js";
export async function exportBundle(project) {
  const clean = JSON.parse(exportProject(project)),
    assets = [];
  let bytes = 0;
  for (const id of new Set(
    clean.graph.nodes.map((n) => n.data.assetId).filter(Boolean),
  )) {
    const a = await readAsset(id);
    if (!a)
      throw Error(
        "Thiếu tài sản: " + id + ". Không tạo bản sao lưu thiếu media.",
      );
    bytes += a.blob.size;
    if (bytes > 100 * 1024 * 1024)
      throw Error("Bản sao lưu giới hạn tổng media 100 MB.");
    assets.push({
      id: a.id,
      name: a.name,
      source: a.source,
      dataURL: await toDataURL(a.blob),
    });
  }
  return JSON.stringify({ ...clean, format: "mooz-cvn-bundle", assets });
}
export async function importBundle(text) {
  if (typeof text !== "string" || text.length > 150 * 1024 * 1024)
    throw Error("Bản sao lưu tối đa 150 MB.");
  const data = JSON.parse(text);
  if (
    data.format !== "mooz-cvn-bundle" ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.assets) ||
    data.assets.length > 1000
  )
    throw Error("Bản sao lưu không hợp lệ.");
  const project = createProject(data.name),
    graph = validateGraph(data.graph),
    map = new Map(),
    created = [];
  let bytes = 0;
  try {
    for (const a of data.assets) {
      if (
        typeof a.id !== "string" ||
        map.has(a.id) ||
        typeof a.name !== "string" ||
        a.name.length > 200 ||
        typeof a.dataURL !== "string" ||
        !/^data:(image|video|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(
          a.dataURL,
        )
      )
        throw Error("Tài sản trong bản sao lưu không hợp lệ.");
      const blob = await (await fetch(a.dataURL)).blob();
      bytes += blob.size;
      if (bytes > 100 * 1024 * 1024) throw Error("Tổng media quá 100 MB.");
      const n = await addAsset(new File([blob], a.name, { type: blob.type }), {
        projectId: project.id,
        source: a.source === "upload" ? "upload" : "imported-result",
      });
      created.push(n);
      map.set(a.id, n.id);
    }
    for (const n of graph.nodes)
      if (n.data.assetId) {
        if (!map.has(n.data.assetId))
          throw Error("Bản sao lưu thiếu media được tham chiếu.");
        n.data.assetId = map.get(n.data.assetId);
      }
    project.graph = graph;
    return { project, created };
  } catch (e) {
    for (const a of created)
      await remove(a.source === "upload" ? "inputs" : "results", a.id);
    throw e;
  }
}
