<template>
  <section class="batchPanel" aria-label="Tạo video hàng loạt">
    <header class="batchHeader">
      <div><h2>Tạo video hàng loạt</h2><p>Đầu vào → từng cảnh → clip → MP4. Dùng model và kho file của Toonflow.</p></div>
      <el-button :loading="refreshing" @click="refresh">Làm mới hàng đợi</el-button>
    </header>
    <div class="batchLayout">
      <el-card class="batchComposer" shadow="never">
        <el-form labelPosition="top" :disabled="busy">
          <el-form-item label="Tên đợt"><el-input v-model="input.name" maxlength="120" /></el-form-item>
          <el-form-item label="Model video">
            <el-select v-model="modelKey" filterable placeholder="Chọn model trong Cài đặt → Model đa phương tiện">
              <el-option v-for="model in videoModels" :key="keyFor(model)" :value="keyFor(model)" :label="`${model.providerLabel} · ${model.label}`" />
            </el-select>
          </el-form-item>
          <el-form-item label="Đầu vào">
            <el-select v-model="input.mode">
              <el-option label="Văn bản → video" value="text" /><el-option label="Ảnh tham chiếu → video" value="images" />
              <el-option label="Khung đầu / cuối" value="frames" /><el-option label="Video nguồn → nối tiếp" value="extend" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="input.mode !== 'text'" label="File đầu vào">
            <el-button :loading="uploading" @click="fileInput?.click()">Thêm ảnh / video</el-button>
            <input ref="fileInput" type="file" multiple :accept="input.mode === 'extend' ? 'video/*' : 'image/*'" hidden @change="upload" />
          </el-form-item>
          <div v-for="(reference, index) in input.references" :key="reference.tag" class="referenceRow">
            <button type="button" class="referenceTag" draggable="true" :title="reference.path" @dragstart="dragReference($event, reference.tag)" @click="insertTag(reference.tag)">{{ reference.tag }}</button>
            <el-image v-if="thumbnails[reference.path]" :src="thumbnails[reference.path]" class="referenceThumbnail" fit="cover" draggable="true" @dragstart="dragReference($event, reference.tag)" @click="insertTag(reference.tag)" />
            <span class="referenceName" :title="reference.path">{{ reference.path.split('/').at(-1) }}</span>
            <el-select v-model="reference.role" size="small" aria-label="Vai trò file">
              <el-option label="Sản phẩm" value="product" /><el-option label="Nhân vật" value="character" />
              <el-option label="Khung đầu" value="firstFrame" /><el-option label="Khung cuối" value="lastFrame" /><el-option label="Video nguồn" value="sourceVideo" />
            </el-select>
            <el-button text type="danger" :disabled="busy" :aria-label="`Bỏ ${reference.tag}`" @click="input.references.splice(index, 1)">×</el-button>
          </div>
          <el-form-item v-if="input.mode === 'images'" label="Ảnh sản phẩm">
            <el-radio-group v-model="input.grouping"><el-radio-button value="combine">Gộp cùng sản phẩm</el-radio-button><el-radio-button value="separate">Mỗi ảnh một tác vụ</el-radio-button></el-radio-group>
          </el-form-item>
          <el-form-item label="Prompt / kịch bản">
            <el-input ref="promptInput" v-model="input.text" type="textarea" :rows="7" placeholder="Nhập prompt. Kéo hoặc bấm @anhN để chèn tham chiếu." @drop.prevent="dropReference" @dragover.prevent />
          </el-form-item>
          <el-checkbox v-model="input.eachLine">Mỗi dòng là một video riêng</el-checkbox>
          <p class="fieldHint">{{ input.eachLine ? 'Một dòng → một clip → một MP4.' : 'Mỗi dòng là một cảnh. Dòng trống ngăn cách các video. Clip được ghép theo thứ tự dòng.' }}</p>
          <div class="optionsGrid">
            <el-form-item label="Tỷ lệ"><el-select v-model="input.ratio"><el-option v-for="ratio in ['9:16', '16:9', '1:1']" :key="ratio" :label="ratio" :value="ratio" /></el-select></el-form-item>
            <el-form-item label="Bản sao"><el-input-number v-model="input.copies" :min="1" :max="10" /></el-form-item>
            <el-form-item label="Giây / cảnh"><el-select v-model="input.duration" clearable placeholder="Mặc định model"><el-option v-for="duration in durations" :key="duration" :value="duration" :label="`${duration}s`" /></el-select></el-form-item>
            <el-form-item label="Độ phân giải"><el-select v-model="input.resolution" clearable placeholder="Mặc định model"><el-option v-for="resolution in resolutions" :key="resolution" :value="resolution" :label="resolution" /></el-select></el-form-item>
          </div>
          <el-checkbox v-if="selectedModel?.audio === 'optional'" v-model="input.generateAudio">Tạo âm thanh cùng video</el-checkbox>
          <el-button class="previewButton" type="primary" :loading="busy" :disabled="!selectedModel || !input.text.trim() || uploading" @click="preview">Xem chính xác tác vụ</el-button>
        </el-form>
      </el-card>
      <div class="batchWork">
        <el-alert v-if="error" :title="error" type="error" :closable="false" showIcon />
        <el-card v-if="proposal" shadow="never" class="previewCard">
          <template #header><div class="cardHeading"><strong>{{ proposal.totalJobs }} video · {{ proposal.totalClips }} lượt tạo clip</strong><el-button type="primary" :loading="busy" :disabled="proposalStale" @click="enqueue">Thêm vào hàng đợi</el-button></div></template>
          <el-alert v-if="proposalStale" title="Đầu vào đã đổi. Bấm Xem chính xác tác vụ để cập nhật trước khi chạy." type="warning" :closable="false" />
          <p>{{ proposal.providerLabel }} · {{ proposal.modelLabel }}</p>
          <p v-if="Object.keys(proposal.binding).length" class="binding">{{ proposal.binding }}</p>
          <el-table :data="proposal.jobs" maxHeight="420" size="small">
            <el-table-column prop="label" label="Video" minWidth="160" />
            <el-table-column label="Ảnh / vai trò" minWidth="230"><template #default="{ row }"><div v-for="ref in row.references" :key="ref.tag" class="previewReference"><el-image v-if="thumbnails[ref.path]" :src="thumbnails[ref.path]" class="referenceThumbnail" fit="cover" /> {{ ref.tag }} · {{ ref.role }} · {{ ref.path.split('/').at(-1) }}</div><span v-if="!row.references.length">Chỉ văn bản</span></template></el-table-column>
            <el-table-column label="Cảnh theo thứ tự" minWidth="280"><template #default="{ row }"><p v-for="(scene, index) in row.scenes" :key="index" class="scenePrompt">{{ Number(index) + 1 }}. {{ scene }}</p></template></el-table-column>
          </el-table>
          <p class="fieldHint">Tạo đợt chưa gửi AI. Bấm Chạy hàng đợi bên dưới để bắt đầu. Số lượt tạo có thể phát sinh phí từ provider của bạn.</p>
        </el-card>
        <el-card v-for="batch in batches" :key="batch.id" class="queueCard" shadow="never">
          <template #header><div class="cardHeading"><div><strong>{{ batch.name }}</strong><small>{{ completed(batch) }}/{{ batch.jobs.length }} video · {{ batch.input.providerId }} / {{ batch.input.modelId }}</small></div><el-button :loading="controlId === batch.id" @click="control(batch)">{{ batch.running ? 'Dừng sau lượt hiện tại' : 'Chạy / tiếp tục' }}</el-button></div></template>
          <el-alert v-if="batch.error" :title="batch.error" type="error" :closable="false" />
          <article v-for="job in batch.jobs" :key="job.id" class="queueJob">
            <div class="jobHeading"><strong>{{ job.label }}</strong><el-tag :type="job.state === 'succeeded' ? 'success' : job.state === 'failed' ? 'danger' : 'info'">{{ stateLabel(job.state) }}</el-tag></div>
            <p v-if="job.error" class="jobError">{{ job.error }}</p>
            <p class="fieldHint">{{ job.references.map(ref => `${ref.tag} · ${ref.role} · ${ref.path.split('/').at(-1)}`).join(" / ") }}</p>
            <div class="clipRow"><span v-for="(clip, index) in job.clips" :key="clip.taskId" :title="`${clip.prompt}\n${clip.taskId}`">Cảnh {{ Number(index) + 1 }} · {{ stateLabel(clip.state) }}<el-button v-for="output in clip.outputs ?? []" :key="output.path" size="small" text @click="download(output)">Tải clip</el-button><el-select v-if="(clip.outputs?.length ?? 0) > 1" :modelValue="clip.selectedPath" :disabled="batch.running || !!job.output" placeholder="Chọn clip để ghép" @change="selectClip(batch, job.id, index, $event)"><el-option v-for="(output, outputIndex) in clip.outputs" :key="output.path" :label="`Clip ${Number(outputIndex) + 1}`" :value="output.path" /></el-select></span></div>
            <div v-if="job.output" class="outputActions"><el-button type="primary" plain @click="openOutput(job.output)">Xem MP4</el-button><el-button @click="download(job.output)">Tải thành phẩm MP4</el-button></div>
          </article>
        </el-card>
      </div>
    </div>
    <el-dialog v-model="playerVisible" title="Thành phẩm MP4" width="min(900px, 90vw)" appendToBody destroyOnClose @closed="releasePlayer"><video v-if="playerUrl" :src="playerUrl" controls class="outputPlayer" /></el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, reactive, ref, watch } from "vue";
import axios from "axios";
import { ElMessage, type InputInstance } from "element-plus";
import type { BatchInput, BatchView, BatchOutput, BatchPlan } from "@toonflow/server/batch";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";
import { useWorkspaceStore } from "@/stores/workspace";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";

type Proposal = { input: BatchInput; jobs: BatchPlan[]; totalJobs: number; totalClips: number; modelLabel: string; providerLabel: string; previewHash: string; binding: Record<string, unknown> };
const workspace = useWorkspaceStore();
const directory = workspace.project!.directory;
const files = useWorkspaceFiles(directory);
const input = reactive<BatchInput>({ name: "Video mới", text: "", eachLine: true, grouping: "combine", mode: "text", providerId: "", modelId: "", ratio: "9:16", copies: 1, references: [] });
const modelKey = ref("");
const models = ref<MediaModel[]>([]);
const thumbnails = reactive<Record<string, string>>({});
const videoModels = computed(() => models.value.filter(model => model.type === "video"));
const keyFor = (model: Pick<MediaModel, "providerId" | "modelId">) => `${model.providerId}:${model.modelId}`;
const selectedModel = computed(() => videoModels.value.find(model => keyFor(model) === modelKey.value));
const durations = computed(() => [...new Set(selectedModel.value?.durationResolutionMap?.flatMap(option => option.duration) ?? [])].sort((a, b) => a - b));
const resolutions = computed(() => [...new Set(selectedModel.value?.durationResolutionMap?.filter(option => !input.duration || option.duration.includes(input.duration)).flatMap(option => option.resolution) ?? [])]);
const busy = ref(false), uploading = ref(false), refreshing = ref(false), error = ref("");
const proposal = ref<Proposal>(), proposalInput = ref("");
const proposalStale = computed(() => proposalInput.value !== JSON.stringify(input));
const batches = ref<BatchView[]>([]), controlId = ref("");
const fileInput = ref<HTMLInputElement>(), promptInput = ref<InputInstance>();
const playerVisible = ref(false), playerUrl = ref("");
let playerHandle: ReturnType<typeof files.acquireUrl> | undefined;
let disposed = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const controller = new AbortController();
const headers = { "x-toonflow-workspace": "1" };
watch(selectedModel, model => { input.providerId = model?.providerId ?? ""; input.modelId = model?.modelId ?? ""; input.duration = undefined; input.resolution = undefined; input.generateAudio = undefined; });
function message(cause: unknown) { return axios.isAxiosError(cause) ? cause.response?.data?.message ?? cause.message : cause instanceof Error ? cause.message : String(cause); }
async function call<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await axios.post(`/api/batch/${name}`, { directory, ...body }, { headers, signal: controller.signal });
  if (data.code !== 200) throw new Error(data.message);
  return data.data;
}
async function refresh() {
  if (refreshing.value || disposed) return;
  refreshing.value = true;
  try { batches.value = await call<BatchView[]>("list"); }
  catch (cause) { if (!disposed) error.value = message(cause); }
  finally { refreshing.value = false; }
}
async function poll() { await refresh(); if (!disposed) pollTimer = setTimeout(poll, 3000); }
onMounted(async () => {
  try { const { data } = await axios.get("/api/ai/media/models", { signal: controller.signal }); models.value = data.data; }
  catch (cause) { if (!disposed) error.value = message(cause); }
  if (!disposed) void poll();
});
onScopeDispose(() => { disposed = true; clearTimeout(pollTimer); controller.abort(); releasePlayer(); for (const url of Object.values(thumbnails)) URL.revokeObjectURL(url); });
async function preview() {
  busy.value = true; error.value = "";
  const snapshot = JSON.parse(JSON.stringify(input));
  try { proposal.value = await call<Proposal>("preview", { input: snapshot }); proposalInput.value = JSON.stringify(snapshot); }
  catch (cause) { error.value = message(cause); }
  finally { busy.value = false; }
}
async function enqueue() {
  if (!proposal.value || proposalStale.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await call("create", { input: proposal.value.input, previewHash: proposal.value.previewHash });
    proposal.value = undefined; await refresh(); ElMessage.success("Đã lưu đợt. Bấm Chạy để bắt đầu gửi AI.");
  } catch (cause) { error.value = message(cause); }
  finally { busy.value = false; }
}
async function control(batch: BatchView) {
  controlId.value = batch.id; error.value = "";
  try { await call("control", { id: batch.id, running: !batch.running }); await refresh(); }
  catch (cause) { error.value = message(cause); }
  finally { controlId.value = ""; }
}
async function selectClip(batch: BatchView, jobId: string, sceneIndex: number, path: string) {
  try { await call("selectClip", { id: batch.id, jobId, sceneIndex, path }); await refresh(); }
  catch (cause) { error.value = message(cause); }
}
async function upload(event: Event) {
  const element = event.target as HTMLInputElement;
  const selected = Array.from(element.files ?? []); element.value = "";
  if (uploading.value) return;
  uploading.value = true; error.value = "";
  try {
    if (selected.length + input.references.length > 64) throw new Error("Tối đa 64 file tham chiếu.");
    if (!(await files.list()).entries.some(entry => entry.name === "batchInputs" && entry.type === "directory")) await files.mkdir("batchInputs");
    const folder = `batchInputs/${crypto.randomUUID()}`;
    await files.mkdir(folder);
    for (const file of selected) {
      if (!/^(image|video)\//.test(file.type) || file.size > 100 * 1024 * 1024 || !file.size) throw new Error("Chọn ảnh/video không rỗng, tối đa 100 MB mỗi file.");
      const path = `${folder}/${file.name.replace(/[^\p{L}\p{N}._ -]/gu, "_")}`;
      await files.write(path, file, true);
      if (file.type.startsWith("image/")) thumbnails[path] = URL.createObjectURL(file);
      const next = Math.max(0, ...input.references.map(ref => Number(ref.tag.slice(4)))) + 1;
      const role = file.type.startsWith("video/") ? "sourceVideo" : input.mode === "frames" ? input.references.some(ref => ref.role === "firstFrame") ? "lastFrame" : "firstFrame" : "product";
      input.references.push({ path, mimeType: file.type, role, tag: `@anh${next}` });
    }
  } catch (cause) { error.value = message(cause); }
  finally { uploading.value = false; }
}
function insertTag(tag: string) {
  const element = promptInput.value?.textarea;
  const start = element?.selectionStart ?? input.text.length, end = element?.selectionEnd ?? start;
  input.text = input.text.slice(0, start) + tag + " " + input.text.slice(end);
  promptInput.value?.focus();
}
function dragReference(event: DragEvent, tag: string) { event.dataTransfer?.setData("text/plain", tag); }
function dropReference(event: DragEvent) { const tag = event.dataTransfer?.getData("text/plain"); if (input.references.some(ref => ref.tag === tag)) insertTag(tag!); }
async function download(output: BatchOutput) {
  try { await saveFile(async () => new Blob([await files.read(output.path)], { type: output.mimeType }), output.path.split("/").at(-1)!); }
  catch (cause) { error.value = message(cause); }
}
async function openOutput(output: BatchOutput) {
  releasePlayer(); playerHandle = files.acquireUrl(output.path);
  try { playerUrl.value = await playerHandle.url; playerVisible.value = true; }
  catch (cause) { releasePlayer(); error.value = message(cause); }
}
function releasePlayer() { playerHandle?.release(); playerHandle = undefined; playerUrl.value = ""; }
const completed = (batch: BatchView) => batch.jobs.filter(job => job.state === "succeeded").length;
function stateLabel(state: string) { return ({ queued: "Đang chờ", submitted: "Đã gửi / đang đối chiếu", running: "Đang tạo", assembling: "Đang ghép MP4", succeeded: "Đã lưu", failed: "Cần xử lý lỗi", interrupted: "Cần đối chiếu", cancelled: "Đã dừng" } as Record<string, string>)[state] ?? state; }
</script>

<style scoped lang="scss">
.batchPanel { position: absolute; inset: 0; overflow: auto; padding: 72px 24px 100px; background: var(--el-bg-color); .batchHeader { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; h2 { margin: 0 0 8px; font-size: 23px; } p { margin: 0; color: var(--el-text-color-secondary); } } .batchLayout { display: grid; grid-template-columns: minmax(310px, 360px) minmax(0, 1fr); gap: 20px; align-items: start; .batchComposer { .el-select { width: 100%; } .referenceRow { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; .referenceTag { padding: 4px 6px; border: 1px solid var(--el-border-color); border-radius: 5px; color: var(--el-color-primary); background: var(--el-fill-color-light); cursor: grab; } .referenceName { max-width: 66px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; } .el-select { width: 115px; flex: 1; } } .optionsGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; } .previewButton { width: 100%; margin-top: 18px; } } .batchWork { min-width: 0; display: grid; gap: 18px; .cardHeading { display: flex; justify-content: space-between; gap: 12px; align-items: center; small { display: block; color: var(--el-text-color-secondary); margin-top: 5px; } } .binding { font-size: 12px; overflow-wrap: anywhere; } .scenePrompt { white-space: pre-wrap; margin: 4px 0; } .previewReference { overflow-wrap: anywhere; } .queueJob { border-bottom: 1px solid var(--el-border-color-lighter); padding: 16px 0; .jobHeading { display: flex; justify-content: space-between; gap: 12px; } .jobError { color: var(--el-color-danger); } .clipRow { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; margin: 14px 0; > span { background: var(--el-fill-color-light); border-radius: 6px; padding: 5px 10px; } } } } } .fieldHint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; } }
.referenceThumbnail { width: 38px; height: 38px; border-radius: 5px; vertical-align: middle; flex-shrink: 0; cursor: grab; }
.outputPlayer { width: 100%; max-height: 72vh; }
@media (max-width: 1050px) { .batchPanel .batchLayout { grid-template-columns: 1fr; } }
</style>
