import { validateGraph, topologicalOrder } from "./graph.js";
import { promptAssetIds } from "./references.js";
import { assertWorkflowTabAvailable } from "./assistant-tab.js";
import { parseScenes } from './queue-plan.js';
import { captureFrame } from '../media-tools.js';
import { processMedia } from './local-media.js';
import { isStale } from './output-state.js';
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
const localTypes = new Set(['captureLastFrame','assembleVideo','videoTrim','videoRotate','videoColor','frameFit','audioMix','subtitles','voiceSync','transition','speed','watermark','audioExtract','voiceover','transcribe']);
export async function createJob({
  projectId,
  graph,
  provider,
  tabId = null,
  chatURL = null,
  title = "Tác vụ",
  kind = null,
  batchLane = null,
  persist = true,
  autoTab = false,
  originalPrompt = '',
  seedAccepted = false,
}) {
  if (!["google", "openai", "local"].includes(provider) && !autoTab) assertWorkflowTabAvailable(tabId);
  const snapshot = validateGraph(graph),
    generators = snapshot.nodes.filter((n) => n.type.startsWith("generate"));
  if (!generators.length && !snapshot.nodes.some(n => localTypes.has(n.type))) throw Error("Luồng chưa có bước xử lý.");
  const inputAssets = {}, acceptedOutputs = {};
  if (seedAccepted) for (const node of snapshot.nodes) {
    if (isStale(snapshot,node)) continue;
    if (node.data.assetId && (node.type.startsWith('generate') || localTypes.has(node.type))) {
      const asset = await readAsset(node.data.assetId); if (!asset) continue;
      inputAssets[asset.id] = { kind: asset.kind, blob: asset.blob, name: asset.name };
      acceptedOutputs[node.id] = { kind: asset.kind, assetId: asset.id };
    } else if (node.type === 'generateText' && node.data.text) acceptedOutputs[node.id] = { kind: 'text', text: node.data.text, ...(node.data.sceneCount ? { scenes: parseScenes(node.data.text,node.data.sceneCount), accepted: true } : {}) };
  }
  const pending = generators.filter(node => !acceptedOutputs[node.id]), p = providerList.find(item => item.id === provider);
  if (pending.length && (!p || pending.some(node => !p.types.includes(node.type==='generateText'?'text':node.type==='generateImage'?'image':'video')))) throw Error('AI đã chọn không hỗ trợ mọi bước trong luồng.');
  if (!['google','openai','local'].includes(provider) && !autoTab && (!Number.isSafeInteger(tabId) || typeof chatURL !== 'string')) throw Error('Chọn tab AI đang kết nối.');
  const required = new Set(snapshot.nodes.filter(node => ((node.type.startsWith('generate') || localTypes.has(node.type)) && !acceptedOutputs[node.id]) || node.type==='preview').map(node=>node.id));
  let changed=true;while(changed){changed=false;for(const edge of snapshot.edges)if(required.has(edge.target)&&!acceptedOutputs[edge.target]&&!required.has(edge.source)){required.add(edge.source);changed=true;}}
  for (const node of snapshot.nodes.filter(node => required.has(node.id))) {
    if (['imageInput','videoInput','audioInput'].includes(node.type)) {
      const asset=node.data.assetId && await readAsset(node.data.assetId);if(!asset)throw Error('Thiếu media đầu vào của luồng.');
      inputAssets[asset.id]={kind:asset.kind,blob:asset.blob,name:asset.name};
    }
    if (!node.type.startsWith('generate') || acceptedOutputs[node.id]) continue;
    const incoming=snapshot.edges.filter(edge=>edge.target===node.id&&edge.targetPort==='reference'), ids=new Set([...incoming.map(edge=>snapshot.nodes.find(source=>source.id===edge.source)?.data.assetId||edge.source),...promptAssetIds(node.data.studioPrompt)]);
    if(ids.size>8)throw Error('Mỗi lượt AI tối đa 8 ảnh tham chiếu.');
    if(snapshot.edges.some(edge=>edge.target===node.id&&edge.targetPort==='video'))throw Error('Adapter hiện tại chưa nhận video gốc làm tham chiếu; chặn trước khi gửi.');
    for(const assetId of promptAssetIds(node.data.studioPrompt)){if(inputAssets[assetId])continue;const asset=await readAsset(assetId);if(!asset||asset.kind!=='image')throw Error('Thiếu ảnh tham chiếu trong prompt.');inputAssets[assetId]={kind:asset.kind,blob:asset.blob,name:asset.name};}
  }
  const job = {
    inputAssets,
    id: crypto.randomUUID(),
    projectId,
    title,
    graph: snapshot,
    requiredNodes: [...required],
    provider,
    tabId,
    chatURL,
    kind,
    batchLane,
    autoTab, originalPrompt,
    status: "queued",
    createdAt: new Date().toISOString(),
    outputs: acceptedOutputs,
    requests: {},
    error: "",
  };
  if (persist) await write("jobs", job);
  return job;
}
async function storeResult(job, nodeId, result) {
  if (result.kind === "text") return { kind: "text", text: result.text };
  if (
    !["image", "video", "audio"].includes(result.kind) ||
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
          (result.kind === "image" ? ".png" : result.kind === 'audio' ? '.mp3' : ".mp4"),
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
    window.dispatchEvent(new CustomEvent("mooz-job-update", { detail: structuredClone(job) }));
  };
  try {
    signal.throwIfAborted();
    job.status = "preparing";
    await update();
    for (const id of topologicalOrder(job.graph)) {
      if (job.requiredNodes && !job.requiredNodes.includes(id)) continue;
      signal.throwIfAborted();
      const n = job.graph.nodes.find((n) => n.id === id),
        incoming = job.graph.edges.filter((e) => e.target === id),
        sources = incoming.filter(e => e.targetPort !== "workflow").map((e) => ({
          edge: e,
          value: job.outputs[e.source],
        }));
      if (job.outputs[id] && job.outputs[id].accepted !== false) continue;
      if (["prompt", "negativePrompt"].includes(n.type)) {
        job.outputs[id] = { kind: "text", text: n.data.text || "" };
        continue;
      }
      if (["imageInput", "videoInput", "audioInput"].includes(n.type)) {
        if (
          !n.data.assetId ||
          !(
            job.inputAssets?.[n.data.assetId] ||
            (await readAsset(n.data.assetId))
          )
        )
          throw Error("Thiếu tài sản đầu vào: " + (n.data.customName || id));
        job.outputs[id] = {
          kind: n.type === "imageInput" ? "image" : n.type === 'audioInput' ? 'audio' : "video",
          assetId: n.data.assetId,
        };
        continue;
      }
      if (n.type === "preview") {
        job.outputs[id] = sources[0]?.value;
        continue;
      }
      if (localTypes.has(n.type)) {
        job.activeNode = id; job.status = 'preparing'; await update();
        const values = sources.map(source => source.value).filter(Boolean),
          files = async kind => Promise.all(values.filter(value => value.kind === kind && value.assetId).map(async value => job.inputAssets?.[value.assetId] || await readAsset(value.assetId))),
          settings = n.data.localSettings ? JSON.parse(n.data.localSettings) : {};
        if (n.type === 'captureLastFrame') {
          const [source] = await files('video'); if (!source) throw Error('Thiếu video nguồn để lấy frame cuối.');
          const asset=await captureFrame({...source,projectId:job.projectId},Number.MAX_SAFE_INTEGER);signal.throwIfAborted();job.outputs[id]={kind:'image',assetId:asset.id};await update();
        } else if (['voiceover','transcribe'].includes(n.type)) {
          const payload = { requestId: job.requests[id] || crypto.randomUUID(), operation: n.type, settings };
          job.requests[id] = payload.requestId;
          if (n.type === 'voiceover') payload.text = values.filter(value => value.kind === 'text').map(value => value.text).join('\n') || n.data.text || '';
          else { const source = values.find(value => ['audio','video'].includes(value.kind)); const asset = source && (job.inputAssets?.[source.assetId] || await readAsset(source.assetId)); if (!asset) throw Error('Nối audio/video trước khi nhận diện phụ đề.'); payload.data = await toDataURL(asset.blob); }
          job.status = 'sent'; await update();
          const response = await api('speech', payload);
          if (response.status !== 'success') throw Error(response.error || 'Chưa nhận được kết quả lời nói.');
          job.status = 'receiving'; job.outputs[id] = await storeResult(job, id, response.result); await update();
        } else {
          const result = await processMedia(n.type === 'assembleVideo' ? 'finalOutput' : n.type, { videos: await files('video'), audios: await files('audio'), images: await files('image'), settings, captions: values.filter(value => value.kind === 'text').map(value => value.text).join('\n\n') || n.data.captions || '', lines: (settings.lines || '').split('\n').filter(Boolean) }, signal, message => { job.localProgress = message; onUpdate?.(structuredClone(job)); });
          signal.throwIfAborted();
          const asset = await addAsset(new File([result.blob], 'MooZ-' + id + (result.kind === 'audio' ? '.mp3' : '.mp4'), { type: result.blob.type }), { projectId: job.projectId, source: 'local' });
          job.outputs[id] = { kind: result.kind || 'video', assetId: asset.id, report: result.report, duration: result.duration }; await update();
        }
        continue;
      }
      const referencedImages = sources.filter(source => source.value?.kind === "image" && source.value.assetId);
      const availableImages = new Set([...referencedImages.map(source => source.value.assetId), ...promptAssetIds(n.data.studioPrompt)]);
      const savedOrder = n.data.referenceOrder ? JSON.parse(n.data.referenceOrder) : [];
      const imageIds = [...new Set([...savedOrder.filter(id => availableImages.has(id)), ...availableImages])];
      const inlinePrompt = (n.data.studioPrompt || "").replace(/@\{asset:([a-zA-Z0-9_-]{1,100})\}/g, (_, assetId) => {
        const index = imageIds.indexOf(assetId);
        if (index < 0) throw Error("Prompt chứa ảnh tham chiếu đã bị gỡ. Hãy nối lại hoặc xóa thẻ tham chiếu.");
        return "[Ảnh " + (index + 1) + "]";
      });
      const mediaType =
          n.type === "generateText"
            ? "text"
            : n.type === "generateImage"
              ? "image"
              : "video",
        scene = n.data.sceneIndex ? sources.find(source => source.value?.scenes)?.value.scenes[n.data.sceneIndex - 1] : null,
        prompt = [
          ...sources
            .filter(
              (s) => s.edge.targetPort === "prompt" && s.value?.kind === "text",
            )
            .map((s) => s.value.scenes ? (scene ? mediaType === 'image' ? scene.imagePrompt : scene.videoPrompt : '') : s.value.text),
          inlinePrompt,
          mediaType === 'video' && scene?.voiceover ? 'Lời thoại yêu cầu (không bảo đảm AI tạo track tiếng): ' + scene.voiceover : '',
          n.data.sceneCount ? `Trả đúng JSON {"scenes":[{"index":1,"title":"...","voiceover":"...","imagePrompt":"...","videoPrompt":"..."}]} gồm đúng ${n.data.sceneCount} cảnh liên tiếp. Mỗi imagePrompt chỉ mô tả ảnh của cảnh đó; mỗi videoPrompt chỉ mô tả chuyển động của cảnh đó. Không kèm markdown.` : '',
          ...sources.filter(source => source.edge.targetPort === 'negative' && source.value?.kind === 'text').map(source => 'Không được: ' + source.value.text),
          n.data.negativePrompt ? 'Không được: ' + n.data.negativePrompt : '',
          n.data.referenceRoles ? imageIds.map((assetId,index) => { const role = JSON.parse(n.data.referenceRoles)[assetId]; return role === 'character' ? `Ảnh ${index+1}: nhân vật tham chiếu; giữ nhận diện nhân vật, không tráo với sản phẩm.` : role === 'product' ? `Ảnh ${index+1}: sản phẩm; giữ hình dạng và nhận diện sản phẩm.` : ''; }).filter(Boolean).join('\n') : '',
          n.data.stylePrompt || "",
          n.data.cameraPrompt || "",
          n.data.motionPrompt || "",
          n.data.effectPrompt || "",
          n.data.quality ? "Yêu cầu chất lượng: " + ({ low: "thấp", medium: "tiêu chuẩn", high: "cao", ultra: "siêu cao", max: "tối đa" }[n.data.quality]) + "." : "",
          n.data.resolution ? "Độ phân giải mong muốn: " + n.data.resolution + "." : "",
          n.data.background === "preserve" ? "Giữ nguyên nền ảnh tham chiếu." : n.data.background === "transparent" ? "Yêu cầu nền trong suốt nếu model hỗ trợ." : "",
        ]
          .filter(Boolean)
          .join("\n");
      if (!prompt.trim()) throw Error("Bước AI chưa có prompt.");
      if (n.data.sceneIndex && !scene) throw Error('Thiếu kịch bản hợp lệ cho cảnh ' + n.data.sceneIndex + '.');
      if (imageIds.length > 8) throw Error('Mỗi lượt AI tối đa 8 ảnh tham chiếu.');
      const refs = []; let referenceBytes = 0;
      if (sources.some(source => source.value?.assetId && !['image','text'].includes(source.value.kind)))
        throw Error("Kết nối hiện tại chưa hỗ trợ video gốc làm tham chiếu; hãy dùng ảnh chụp khung hình.");
      for (const assetId of imageIds) {
        const asset =
          job.inputAssets?.[assetId] || (await readAsset(assetId));
        if (!asset) throw Error("Tài sản tham chiếu đã bị xóa.");
        if (asset.kind !== "image")
          throw Error(
            "Bản web chưa gửi video gốc làm tham chiếu; hãy dùng ảnh hoặc xử lý trên desktop.",
          );
        referenceBytes+=asset.blob.size;if(asset.blob.size>8*1024*1024||referenceBytes>32*1024*1024)throw Error('Ảnh tham chiếu vượt 8 MB/ảnh hoặc tổng 32 MB; giảm kích thước trước khi gửi.');
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
        quality: ["ultra", "max"].includes(n.data.quality) ? "high" : n.data.quality || "medium",
        ...(n.data.duration == null ? {} : { duration: n.data.duration }),
      });
      job.requestStates ||= {}; job.requestStates[id] = result.status;
      if (result.status !== "success") {
        job.code = result.code;
        if (result.retryAfterMs) job.retryAt = Date.now() + result.retryAfterMs;
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
      if (result.result?.kind !== mediaType) throw Error('AI trả sai loại kết quả; không chấp nhận ảnh poster thay video.');
      job.status = 'receiving';
      job.outputs[id] = await storeResult(job, id, result.result);
      if (n.data.sceneCount) {
        job.outputs[id].accepted = false; await update();
        job.outputs[id].scenes = parseScenes(job.outputs[id].text, n.data.sceneCount);
        job.outputs[id].accepted = true;
      }
      job.status = "receiving";
      await update();
    }
    signal.throwIfAborted();
    job.status = "success";
    job.activeNode = null;
    job.error = "";
    const last = topologicalOrder(job.graph).reverse().find(id => { const node=job.graph.nodes.find(node=>node.id===id);return (node.type.startsWith("generate")||localTypes.has(node.type))&&job.outputs[id]; });
    job.resultId = job.outputs[last]?.assetId || null;
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
  if(result.status==='error') { job.status='error';job.requestStates||={};job.requestStates[nodeId]='error';job.error=result.error||'Máy chủ xác nhận lượt chưa được gửi thành công.';await write('jobs',job);return job; }
  if (result.status !== "success")
    throw Error(
      result.error || "Máy chủ chưa có kết quả hoàn tất. Không tự gửi lại.",
    );
  const node = job.graph.nodes.find(item => item.id === nodeId);
  const expected = node?.type === 'generateText' || node?.type === 'transcribe' ? 'text' : node?.type === 'voiceover' || node?.type === 'audioExtract' ? 'audio' : node?.type === 'generateImage' || node?.type === 'captureLastFrame' ? 'image' : 'video';
  if (result.result?.kind !== expected) throw Error('Kết quả đối chiếu không đúng loại đầu ra của bước.');
  const output = await storeResult(job, nodeId, result.result);
  job.outputs[nodeId] = output;
  if (node?.data.sceneCount) {
    output.accepted = false;
    try { output.scenes = parseScenes(output.text,node.data.sceneCount); output.accepted = true; } catch(error) { job.error = error.message; }
  }
  job.status = "review";
  job.error =
    "Đã thu hồi kết quả của bước bị gián đoạn. Xem Kho Kết quả; các bước còn lại chưa tự chạy.";
  await write("jobs", job);
  return job;
}

export async function resumeJob(id, correctedScript = null) {
  const job = await read('jobs', id);
  if (!job || !['error','stopped','review'].includes(job.status) || controllers.has(id)) throw Error('Chỉ tiếp tục job đã dừng/lỗi hoặc đã đối chiếu; không tự gửi lại lượt chưa rõ.');
  const node = job.graph.nodes.find(node => node.id === job.activeNode), output = job.outputs[job.activeNode];
  if (node?.data.sceneCount && output?.accepted === false) {
    if (typeof correctedScript !== 'string') throw Error('Sửa JSON kịch bản trước khi tiếp tục.');
    const scenes = parseScenes(correctedScript, node.data.sceneCount);
    output.originalText ||= output.text; output.text = correctedScript; output.scenes = scenes; output.accepted = true;
  } else if (job.requests[job.activeNode] && !output) {
    if (job.requestStates?.[job.activeNode] !== 'error') throw Error('Lượt đã có request ID nhưng chưa có kết quả được chấp nhận. Kiểm tra kết quả trước, không gửi lại.');
    job.requestHistory ||= []; job.requestHistory.push({ nodeId: job.activeNode, requestId: job.requests[job.activeNode], status: 'error', reviewedAt: new Date().toISOString() });
    delete job.requests[job.activeNode];
  }
  job.status = 'queued'; job.error = ''; job.updatedAt = new Date().toISOString();
  await write('jobs', job); return job;
}
