import { validateGraph, topologicalOrder } from "./graph.js";
import {
  readAsset,
  addAsset,
  toDataURL,
  read,
  write,
  list,
} from "./storage.js";
import { api, providerList } from "../client-api.js";
const controllers = new Map();
export async function createJob({
  projectId,
  graph,
  provider,
  tabId = null,
  chatURL = null,
  title = "Tác vụ",
  kind = null,
}) {
  const snapshot = validateGraph(graph),
    generators = snapshot.nodes.filter((n) => n.type.startsWith("generate"));
  if (!generators.length) throw Error("Luồng chưa có bước AI.");
  const p = providerList.find((p) => p.id === provider);
  if (
    !p ||
    generators.some(
      (n) =>
        !p.types.includes(
          n.type === "generateText"
            ? "text"
            : n.type === "generateImage"
              ? "image"
              : "video",
        ),
    )
  )
    throw Error("AI đã chọn không hỗ trợ mọi bước trong luồng.");
  if (
    !["google", "openai"].includes(provider) &&
    (!Number.isSafeInteger(tabId) || typeof chatURL !== "string")
  )
    throw Error("Chọn tab AI đang kết nối.");
  const inputAssets = {};
  for (const n of snapshot.nodes)
    if (["imageInput", "videoInput"].includes(n.type)) {
      const a = n.data.assetId && (await readAsset(n.data.assetId));
      if (!a) throw Error("Thiếu media đầu vào của luồng.");
      inputAssets[a.id] = { kind: a.kind, blob: a.blob, name: a.name };
    }
  const job = {
    inputAssets,
    id: crypto.randomUUID(),
    projectId,
    title,
    graph: snapshot,
    provider,
    tabId,
    chatURL,
    kind,
    status: "queued",
    createdAt: new Date().toISOString(),
    outputs: {},
    requests: {},
    error: "",
  };
  await write("jobs", job);
  return job;
}
async function storeResult(job, nodeId, result) {
  if (result.kind === "text") return { kind: "text", text: result.text };
  if (
    !["image", "video"].includes(result.kind) ||
    typeof result.url !== "string" ||
    !result.url.startsWith("data:" + result.kind + "/")
  )
    throw Error("Kết quả media không hợp lệ.");
  const response = await fetch(result.url),
    blob = await response.blob(),
    asset = await addAsset(
      new File(
        [blob],
        "MooZ-" +
          job.id.slice(0, 8) +
          (result.kind === "image" ? ".png" : ".mp4"),
        { type: blob.type },
      ),
      { projectId: job.projectId, source: "ai" },
    );
  return { kind: result.kind, assetId: asset.id };
}
async function execute(job, signal, onUpdate) {
  const update = async () => {
    job.updatedAt = new Date().toISOString();
    await write("jobs", job);
    onUpdate?.(structuredClone(job));
  };
  try {
    signal.throwIfAborted();
    job.status = "preparing";
    await update();
    for (const id of topologicalOrder(job.graph)) {
      signal.throwIfAborted();
      const n = job.graph.nodes.find((n) => n.id === id),
        incoming = job.graph.edges.filter((e) => e.target === id),
        sources = incoming.map((e) => ({
          edge: e,
          value: job.outputs[e.source],
        }));
      if (n.type === "prompt") {
        job.outputs[id] = { kind: "text", text: n.data.text || "" };
        continue;
      }
      if (["imageInput", "videoInput"].includes(n.type)) {
        if (
          !n.data.assetId ||
          !(
            job.inputAssets?.[n.data.assetId] ||
            (await readAsset(n.data.assetId))
          )
        )
          throw Error("Thiếu tài sản đầu vào: " + (n.data.customName || id));
        job.outputs[id] = {
          kind: n.type === "imageInput" ? "image" : "video",
          assetId: n.data.assetId,
        };
        continue;
      }
      if (n.type === "preview") {
        job.outputs[id] = sources[0]?.value;
        continue;
      }
      const mediaType =
          n.type === "generateText"
            ? "text"
            : n.type === "generateImage"
              ? "image"
              : "video",
        prompt = [
          ...sources
            .filter(
              (s) => s.edge.targetPort === "prompt" && s.value?.kind === "text",
            )
            .map((s) => s.value.text),
          n.data.studioPrompt || "",
          n.data.stylePrompt || "",
          n.data.cameraPrompt || "",
          n.data.quality === "high"
            ? "Ưu tiên chi tiết và chất lượng hình ảnh cao."
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      if (!prompt.trim()) throw Error("Bước AI chưa có prompt.");
      const refs = [];
      for (const s of sources.filter((s) => s.value?.assetId)) {
        const asset =
          job.inputAssets?.[s.value.assetId] ||
          (await readAsset(s.value.assetId));
        if (!asset) throw Error("Tài sản tham chiếu đã bị xóa.");
        if (asset.kind !== "image")
          throw Error(
            "Bản web chưa gửi video gốc làm tham chiếu; hãy dùng ảnh hoặc xử lý trên desktop.",
          );
        refs.push(await toDataURL(asset.blob));
      }
      const requestId = job.requests[id] || crypto.randomUUID();
      job.requests[id] = requestId;
      job.activeNode = id;
      job.status = "sent";
      await update();
      const result = await api("jobs", {
        requestId,
        provider: job.provider,
        tabId: job.tabId,
        chatURL: job.chatURL,
        mediaType,
        prompt,
        referenceImages: refs,
        size: n.data.size || "16:9",
        quality: n.data.quality || "medium",
        duration: n.data.duration ?? 5,
      });
      if (result.status !== "success") {
        job.status =
          result.status === "error"
            ? "error"
            : result.status === "queued"
              ? "queued"
              : "unknown";
        job.error =
          result.error ||
          "Lượt chưa có kết quả chắc chắn. Kiểm tra tab và lịch sử máy chủ.";
        await update();
        return job;
      }
      signal.throwIfAborted();
      job.outputs[id] = await storeResult(job, id, result.result);
      job.status = "receiving";
      await update();
    }
    signal.throwIfAborted();
    job.status = "success";
    job.activeNode = null;
    job.error = "";
    await update();
    return job;
  } catch (e) {
    job.status = signal.aborted
      ? job.status === "sent"
        ? "unknown"
        : "stopped"
      : job.status === "sent"
        ? "unknown"
        : "error";
    job.error = signal.aborted
      ? "Đã dừng nhận kết quả. Nếu đã gửi AI, kiểm tra tab trước khi tạo lượt mới."
      : e.message;
    await update();
    return job;
  }
}
export async function startJob(id, onUpdate) {
  if (controllers.has(id)) throw Error("Tác vụ đang chạy.");
  const job = await read("jobs", id);
  if (!job || job.status !== "queued")
    throw Error("Chỉ chạy tác vụ mới đang chờ. Không tự gửi lại lượt cũ.");
  const control = new AbortController();
  controllers.set(id, control);
  const resource = job.tabId ? "tab-" + job.tabId : "provider-" + job.provider;
  try {
    if (!navigator.locks)
      throw Error(
        "Trình duyệt thiếu Web Locks; dùng Chrome/Edge mới qua HTTPS hoặc localhost.",
      );
    return await navigator.locks.request(
      "mooz-cvn-job-" + id,
      { signal: control.signal },
      () =>
        navigator.locks.request(
          "mooz-cvn-" + resource,
          { signal: control.signal },
          async () => {
            const latest = await read("jobs", id);
            if (latest.status !== "queued") return latest;
            return execute(latest, control.signal, onUpdate);
          },
        ),
    );
  } finally {
    controllers.delete(id);
  }
}
export async function stopJob(id) {
  const job = await read("jobs", id);
  if (!job) return;
  controllers.get(id)?.abort();
  if (job.status === "queued") {
    job.status = "stopped";
    await write("jobs", job);
  } else if (["preparing", "sent", "receiving"].includes(job.status)) {
    job.status = "unknown";
    job.error = "Đã yêu cầu dừng. Kiểm tra tab AI; không tự gửi lại.";
    await write("jobs", job);
  }
}
export async function recoverJobs() {
  if (!navigator.locks) return;
  for (const old of await list("jobs")) {
    if (!["sent", "preparing", "receiving"].includes(old.status)) continue;
    await navigator.locks.request(
      "mooz-cvn-job-" + old.id,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        const job = await read("jobs", old.id);
        if (!job || !["sent", "preparing", "receiving"].includes(job.status))
          return;
        job.status = "unknown";
        job.error =
          "Phiên trước gián đoạn; kiểm tra kết quả trước khi chạy lại.";
        await write("jobs", job);
      },
    );
  }
}

export async function inspectJob(id) {
  const job = await read("jobs", id);
  if (!job || job.status !== "unknown") return job;
  const nodeId = job.activeNode,
    requestId = job.requests[nodeId];
  if (!requestId)
    throw Error(
      "Lượt chưa có mã gửi. Đối chiếu đầu vào trước khi tạo tác vụ mới.",
    );
  const result = await api("jobs/" + requestId);
  if (result.status !== "success")
    throw Error(
      result.error || "Máy chủ chưa có kết quả hoàn tất. Không tự gửi lại.",
    );
  job.outputs[nodeId] = await storeResult(job, nodeId, result.result);
  job.status = "review";
  job.error =
    "Đã thu hồi kết quả của bước bị gián đoạn. Xem Kho Kết quả; các bước còn lại chưa tự chạy.";
  await write("jobs", job);
  return job;
}
