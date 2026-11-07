import { createHash } from "node:crypto";
import { dirname, join, extname } from "node:path";
import { mkdir, readFile, writeFile, writeAtomic } from "@toonflow/file";
import type { MediaGenerationRequest, MediaModel } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { getMediaProvider } from "@/utils/media/provider";
import { listMediaModels, readReference } from "@/utils/media/generation";
import * as mediaTasks from "@/utils/media/tasks";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { mergeVideo } from "@/utils/media/render";
import { batchInputSchema, planBatch, type BatchInput, type BatchView, type BatchJob } from "./composer";

type BatchRecord = BatchView & { providerFingerprint: string; inputHashes: Record<string, string> };
const batches = new Map<string, BatchRecord>();
const persistence = new Map<string, Promise<void>>();
let active = false;
let initialized = false;
const locations = new Map<string, { id: string; directory: string }>();
let registryQueue = Promise.resolve();
const registryPath = join(dirname(conf.path), "batchQueue.json");
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function batchPath(batch: BatchRecord) { return `batchProjects/${batch.id}/batch.json`; }
function view(batch: BatchRecord): BatchView {
  const { providerFingerprint, inputHashes, ...value } = batch;
  return structuredClone(value);
}
async function save(batch: BatchRecord) {
  const { path } = await resolveWorkspacePath(batch.directory, batchPath(batch), true);
  const data = JSON.stringify(batch);
  const previous = persistence.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeAtomic(path, data, { mode: 0o600 }));
  persistence.set(path, next);
  try { await next; } finally { if (persistence.get(path) === next) persistence.delete(path); }
}
async function fingerprint(input: BatchInput) {
  const provider = await getMediaProvider(input.providerId);
  const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, unknown> | undefined;
  return digest(JSON.stringify([provider.source, configs?.[input.providerId] ?? {}]));
}
function requestMode(input: BatchInput, model: MediaModel, referenceCount: number): MediaGenerationRequest["mode"] {
  const modes: unknown[] = Array.isArray(model.mode) ? model.mode : ["text"];
  if (input.mediaType === "image") {
    if (input.mode === "text" && modes.includes("text")) return undefined;
    if (input.mode === "images" && (modes.includes("multiReference") || referenceCount === 1 && modes.includes("singleImage"))) return undefined;
    return fail("Model ảnh không hỗ trợ đầu vào đã chọn.");
  }
  if (input.mode === "text" && modes.includes("text")) return "text";
  if (input.mode === "images") {
    if (referenceCount === 1 && modes.includes("singleImage")) return "singleImage";
    const mode = modes.find(mode => Array.isArray(mode) && mode.some(value => typeof value === "string" && /^imageReference:\d+$/.test(value) && Number(value.split(":")[1]) >= referenceCount));
    if (mode) return mode as MediaGenerationRequest["mode"];
  }
  if (input.mode === "frames") {
    const hasLast = input.references.some(ref => ref.role === "lastFrame");
    if (hasLast && modes.includes("startEndRequired")) return "startEndRequired";
    if (modes.includes("endFrameOptional")) return "endFrameOptional";
    if (hasLast && modes.includes("startFrameOptional")) return "startFrameOptional";
    if (!hasLast && modes.includes("singleImage")) return "singleImage";
  }
  if (input.mode === "extend") {
    const mode = modes.find(mode => Array.isArray(mode) && mode.some(value => typeof value === "string" && /^videoReference:[1-9]\d*$/.test(value)));
    if (mode) return mode as MediaGenerationRequest["mode"];
  }
  return fail("Model không hỗ trợ chế độ hoặc số ảnh/video đã chọn. Chọn lại model hoặc đầu vào.");
}
export async function preview(raw: unknown, directory: string) {
  const input = batchInputSchema.parse(raw);
  const jobs = planBatch(input);
  const model = (await listMediaModels()).find(model => model.type === input.mediaType && model.providerId === input.providerId && model.modelId === input.modelId);
  if (!model) fail("Chọn model đã cài trong Cài đặt → Model đa phương tiện.");
  for (const job of jobs) requestMode(input, model, job.references.length);
  if (input.duration !== undefined || input.resolution !== undefined) {
    if (model.durationResolutionMap?.length && !model.durationResolutionMap.some(option =>
      (input.duration === undefined || option.duration.includes(input.duration)) && (input.resolution === undefined || option.resolution.includes(input.resolution)))) fail("Thời lượng/độ phân giải không thuộc cấu hình model.");
  }
  const sourceHashes: Record<string, string> = {};
  for (const ref of input.references) {
    const source = await readReference(directory, ref, ref.role === "sourceVideo" ? "video" : "image");
    sourceHashes[ref.path] = digest(Buffer.from(source.data, "base64"));
  }
  const providerFingerprint = await fingerprint(input);
  const configs = conf.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const config = configs?.[input.providerId];
  const binding = config ? Object.fromEntries(["relayUrl", "deviceId", "epoch", "tabId", "conversationUrl"].filter(key => typeof config[key] === "string").map(key => [key, config[key]])) : {};
  return { input, jobs, sourceHashes, modelLabel: model.label, providerLabel: model.providerLabel, binding,
    totalJobs: jobs.length, totalClips: jobs.reduce((total, job) => total + job.scenes.length, 0),
    previewHash: digest(JSON.stringify([input, jobs, providerFingerprint, sourceHashes])) };
}
export async function initialize() {
  if (initialized) return;
  initialized = true;
  let records: { id: string; directory: string }[];
  try { records = JSON.parse(await readFile(registryPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!Array.isArray(records) || records.length > 1000) fail("Danh mục hàng đợi không hợp lệ.");
  for (const location of records) {
    if (!/^[0-9a-f-]{36}$/i.test(location.id) || typeof location.directory !== "string") fail("Danh mục hàng đợi không hợp lệ.");
    locations.set(location.id, location);
    try {
      const { path } = await resolveWorkspacePath(location.directory, `batchProjects/${location.id}/batch.json`);
      const batch: BatchRecord = JSON.parse(await readFile(path, "utf8"));
      batch.input = batchInputSchema.parse(batch.input);
      if (batch.id !== location.id || batch.directory !== location.directory || !Array.isArray(batch.jobs)
        || batch.jobs.length > 100 || batch.jobs.some(job => !Array.isArray(job.clips) || job.clips.length > 12 || job.clips.some(clip => !/^[0-9a-f-]{36}$/i.test(clip.taskId)))) fail("Dữ liệu batch bị thay đổi hoặc không hợp lệ.");
      batches.set(batch.id, batch);
    } catch (error) {
      // A disconnected external drive must not prevent the workstation opening.
      console.error(`Chưa mở lại được batch ${location.id}:`, error instanceof Error ? error.message : String(error));
    }
  }
  void pump().catch(error => console.error("Hàng đợi tạm dừng do lỗi lưu dữ liệu:", error));
}
export function list(directory: string) { return [...batches.values()].filter(batch => batch.directory === directory).map(view).sort((a, b) => b.createdAt - a.createdAt); }
export async function create(directory: string, raw: unknown, previewHash: string) {
  const proposal = await preview(raw, directory);
  if (proposal.previewHash !== previewHash) fail("Đầu vào hoặc kết nối đã thay đổi. Xem lại bảng tác vụ trước khi thêm hàng đợi.", 409);
  if (batches.size >= 1000) fail("Hàng đợi đạt giới hạn 1.000 đợt.");
  const id = crypto.randomUUID();
  const folder = `batchProjects/${id}`;
  const root = await resolveWorkspacePath(directory, folder, true);
  await mkdir(root.path, { recursive: true });
  const inputHashes: Record<string, string> = {};
  const copied = new Map<string, string>();
  for (const ref of proposal.input.references) {
    // Read through the existing media/path boundary; source files remain intact.
    const source = await readReference(directory, ref, ref.role === "sourceVideo" ? "video" : "image");
    const bytes = Buffer.from(source.data, "base64");
    if (digest(bytes) !== proposal.sourceHashes[ref.path]) fail("File đầu vào vừa thay đổi. Xem lại tác vụ trước khi chạy.", 409);
    const name = `${folder}/${ref.tag.slice(1)}${extname(ref.path).replace(/[^a-zA-Z0-9.]/g, "") || ".bin"}`;
    const destination = await resolveWorkspacePath(directory, name, true);
    await writeFile(destination.path, bytes, { flag: "wx", mode: 0o600 });
    inputHashes[name] = digest(bytes);
    copied.set(ref.path, name);
  }
  const jobs: BatchJob[] = proposal.jobs.map(plan => ({ ...plan, id: crypto.randomUUID(), state: "queued",
    references: plan.references.map(ref => ({ ...ref, path: copied.get(ref.path)! })),
    clips: plan.scenes.map(prompt => ({ prompt, taskId: crypto.randomUUID(), state: "queued" })),
  }));
  const batch: BatchRecord = { id, directory, name: proposal.input.name, running: false, createdAt: Date.now(),
    input: proposal.input, jobs, providerFingerprint: await fingerprint(proposal.input), inputHashes };
  await save(batch);
  batches.set(id, batch);
  locations.set(id, { id, directory });
  const registryData = JSON.stringify([...locations.values()]);
  registryQueue = registryQueue.catch(() => {}).then(() => writeAtomic(registryPath, registryData, { mode: 0o600 }));
  await registryQueue;
  return view(batch);
}
export async function control(directory: string, id: string, running: boolean) {
  const batch = batches.get(id);
  if (!batch || batch.directory !== directory) fail("Không tìm thấy batch trong dự án.", 404);
  batch.running = running;
  batch.error = undefined;
  await save(batch);
  if (running) void pump().catch(error => console.error("Hàng đợi tạm dừng do lỗi lưu dữ liệu:", error));
  return view(batch);
}
export async function selectClip(directory: string, id: string, jobId: string, sceneIndex: number, path: string) {
  const batch = batches.get(id);
  if (!batch || batch.directory !== directory) fail("Không tìm thấy batch trong dự án.", 404);
  if (batch.running) fail("Dừng hàng đợi trước khi chọn clip.", 409);
  const job = batch.jobs.find(job => job.id === jobId);
  const clip = job?.clips[sceneIndex];
  if (!job || !clip || !clip.outputs?.some(output => output.path === path)) fail("Clip không thuộc cảnh này.");
  if (job.output) fail("Thành phẩm đã được xuất; tạo đợt mới để thay clip.", 409);
  clip.selectedPath = path;
  batch.error = undefined;
  await save(batch);
  return view(batch);
}
async function assemble(batch: BatchRecord, job: BatchJob) {
  const clips = job.clips.map(clip => {
    if (!clip.outputs?.length) return fail("Thiếu clip, chưa ghép thành phẩm.");
    const selected = clip.outputs.length === 1 ? clip.outputs[0] : clip.outputs.find(output => output.path === clip.selectedPath);
    if (!selected) return fail("Một cảnh trả nhiều clip; chọn clip dùng để ghép trong hàng đợi. Tất cả kết quả đã được giữ lại.");
    return selected;
  });
  job.output = await mergeVideo(batch.directory, clips, `batchProjects/${batch.id}/${job.id}.mp4`, batch.input.ratio);
  job.state = "succeeded";
  await save(batch);
}
async function advance(batch: BatchRecord) {
  const job = batch.jobs.find(job => job.state !== "succeeded");
  if (!job) { batch.running = false; await save(batch); return; }
  if (job.state === "failed") fail(job.error || "Batch đang chờ xử lý lỗi; không tự gửi lại.");
  if (await fingerprint(batch.input) !== batch.providerFingerprint) fail("Cấu hình model/tab đã đổi. Khôi phục cấu hình ban đầu để tiếp tục; tác vụ chưa được gửi lại.", 409);
  const model = (await listMediaModels()).find(model => model.providerId === batch.input.providerId && model.modelId === batch.input.modelId && model.type === batch.input.mediaType);
  if (!model) fail("Model của đợt này không còn được cài.");
  const clip = job.clips.find(clip => clip.state !== "succeeded");
  if (!clip) {
    if (batch.input.mediaType === "image") {
      job.outputs = job.clips.flatMap(clip => clip.outputs ?? []);
      if (!job.outputs.length) fail("Chưa lưu được ảnh kết quả.");
      job.state = "succeeded";
      await save(batch);
    } else { job.state = "assembling"; await save(batch); await assemble(batch, job); }
    return;
  }
  if (clip.state === "queued") {
    for (const reference of job.references) {
      const { path } = await resolveWorkspacePath(batch.directory, reference.path);
      if (digest(await readFile(path)) !== batch.inputHashes[reference.path]) fail("Ảnh/video đầu vào đã bị sửa; dừng trước khi gửi.");
    }
    const mode = requestMode(batch.input, model, job.references.length);
    const request: MediaGenerationRequest = {
      providerId: batch.input.providerId, modelId: batch.input.modelId, mode,
      prompt: [clip.prompt, batch.input.commonPrompt, batch.input.negativePrompt ? `Điều cần tránh: ${batch.input.negativePrompt}` : ""].filter(Boolean).join("\n") + (job.references.length ? "\nTham chiếu: " + job.references.map((ref, index) => `${ref.tag} = ${ref.role}, file ${index + 1}`).join("; ") : ""),
      other: batch.input.other, ratio: batch.input.ratio, duration: batch.input.duration, resolution: batch.input.resolution, generateAudio: batch.input.generateAudio,
      outputDirectory: `batchProjects/${batch.id}/clips`,
      images: job.references.filter(ref => ref.role === "product" || ref.role === "character").map(({ path, mimeType }) => ({ path, mimeType })),
      videos: job.references.filter(ref => ref.role === "sourceVideo").map(({ path, mimeType }) => ({ path, mimeType })),
    };
    if (batch.input.mediaType === "image") {
      delete request.mode; delete request.duration; delete request.resolution; delete request.generateAudio; delete request.videos;
      if (batch.input.size) request.size = batch.input.size;
    }
    const first = job.references.find(ref => ref.role === "firstFrame");
    const last = job.references.find(ref => ref.role === "lastFrame");
    if (first) {
      if (mode === "singleImage") request.images = [{ path: first.path, mimeType: first.mimeType }];
      else request.firstFrame = { path: first.path, mimeType: first.mimeType };
    }
    if (last) request.lastFrame = { path: last.path, mimeType: last.mimeType };
    // The intent and UUID reach disk BEFORE the provider can receive a request.
    clip.request = request as unknown as Record<string, unknown>;
    clip.state = "submitted"; job.state = "running";
    await save(batch);
  }
  if (clip.state === "submitted") {
    if (!clip.request) fail("Thiếu snapshot lượt gửi; giữ tác vụ để đối chiếu.");
    // Starting the same UUID/request is idempotent, including a crash before first dispatch.
    await mediaTasks.start(batch.directory, clip.taskId, batch.input.mediaType, clip.request as unknown as MediaGenerationRequest);
  }
  const [status] = await mediaTasks.status(batch.directory, [clip.taskId], true);
  if (!status) fail("Không đọc được tác vụ đã gửi.");
  if (status.state === "succeeded" && status.result?.code === 200 && status.result.data?.length) {
    clip.outputs = status.result.data; clip.state = "succeeded"; await save(batch);
  } else if (["failed", "cancelled", "interrupted"].includes(status.state)) {
    clip.state = status.state; clip.error = status.result?.message ?? "Tác vụ cần kiểm tra, chưa tự gửi lại.";
    job.state = "failed"; job.error = clip.error; await save(batch); fail(clip.error);
  }
}
async function pump() {
  if (active) return;
  active = true;
  try {
    while (true) {
      const batch = [...batches.values()].find(batch => batch.running);
      if (!batch) break;
      try { await advance(batch); }
      catch (error) { batch.running = false; batch.error = error instanceof Error ? error.message : String(error); await save(batch); }
      if (batch.running) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally { active = false; }
}
