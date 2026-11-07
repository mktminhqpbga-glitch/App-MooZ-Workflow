<template>
  <section class="postStudio"><header><div><h1>Phòng hậu kỳ</h1><p>Cắt, ghép theo thứ tự, thêm nhạc/lời đọc/phụ đề và xuất MP4 trên máy.</p></div><projectPicker :disabled="processing" /></header><el-alert v-if="error" :title="error" type="error" :closable="false" /><template v-if="workspace.project"><div class="postLayout"><el-card shadow="never"><el-space wrap><el-button :disabled="processing" @click="clipInput?.click()">Thêm video</el-button><el-button :disabled="processing" @click="router.push('/library')">Chọn video từ Kho</el-button><el-button :disabled="processing" @click="saveDraft">Lưu bản dựng</el-button></el-space><input ref="clipInput" type="file" accept="video/*" multiple hidden @change="uploadClips" /><article v-for="(clip, index) in clips" :key="clip.path" class="editClip"><div><strong>{{ index + 1 }}. {{ clip.name }}</strong><el-button text :disabled="processing || index === 0" @click="moveClip(index, -1)">↑</el-button><el-button text :disabled="processing || index === clips.length - 1" @click="moveClip(index, 1)">↓</el-button><el-button text type="danger" :disabled="processing" @click="clips.splice(index, 1)">Bỏ khỏi bản dựng</el-button></div><el-space wrap><label>Từ giây <el-input-number v-model="clip.start" :disabled="processing" :min="0" :precision="2" /></label><label>Đến giây <el-input-number v-model="clip.end" :disabled="processing" :min="0" :precision="2" /></label><small>0 ở cuối = hết clip</small></el-space></article><el-form labelPosition="top" :disabled="processing"><el-form-item label="Tỷ lệ MP4"><el-select v-model="ratio"><el-option v-for="value in ['16:9','9:16','1:1','4:3']" :key="value" :value="value" :label="value" /></el-select></el-form-item><el-form-item label="Nhạc nền"><el-space><el-button @click="musicInput?.click()">{{ music ? music.split('/').at(-1) : 'Chọn file nhạc' }}</el-button><el-button v-if="music" text @click="music = ''">Bỏ nhạc</el-button><el-input-number v-model="musicVolume" :min="0" :max="2" :step="0.1" :precision="1" /></el-space><input ref="musicInput" type="file" accept="audio/*" hidden @change="uploadAudio($event, 'music')" /></el-form-item><el-form-item label="Lời đọc"><el-space><el-button @click="voiceInput?.click()">{{ voice ? voice.split('/').at(-1) : 'Chọn file lời đọc' }}</el-button><el-button v-if="voice" text @click="voice = ''">Bỏ lời đọc</el-button><el-input-number v-model="voiceVolume" :min="0" :max="2" :step="0.1" :precision="1" /></el-space><input ref="voiceInput" type="file" accept="audio/*" hidden @change="uploadAudio($event, 'voice')" /></el-form-item><el-form-item label="Âm lượng tiếng gốc"><el-input-number v-model="originalVolume" :min="0" :max="2" :step="0.1" :precision="1" /></el-form-item><el-form-item label="Phụ đề SRT"><el-input v-model="subtitles" type="textarea" :rows="5" placeholder="1&#10;00:00:00,000 --> 00:00:02,000&#10;Nội dung phụ đề tiếng Việt" /></el-form-item><el-button type="primary" :disabled="!clips.length" :loading="processing" @click="exportVideo">{{ processing ? progress : 'Xuất MP4 thành phẩm' }}</el-button><el-button v-if="processing" type="danger" @click="exportController?.abort()">Dừng xuất</el-button></el-form></el-card><div class="postResults"><el-card v-for="output in exports" :key="output.path" shadow="never"><strong>{{ output.name }}</strong><p>{{ output.state === 'succeeded' ? 'Đã lưu thành phẩm' : 'Bản xuất chưa hoàn tất; file gốc vẫn được giữ' }}</p><el-button v-if="output.state !== 'succeeded'" @click="restoreExport(output.path)">Khôi phục bản dựng</el-button><el-space v-if="output.state === 'succeeded'"><el-button @click="preview(output.path)">Xem MP4</el-button><el-button @click="download(output.path)">Tải MP4</el-button></el-space></el-card><video v-if="previewUrl" :src="previewUrl" controls /></div></div></template><el-alert v-else title="Chọn thư mục dự án để bắt đầu hậu kỳ." type="info" :closable="false" /></section>
</template>
<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { z } from "@toonflow/nodes-scaffold/runtime";
import { createBrowserFfmpeg, type BrowserFfmpegCommand, type BrowserFfmpegFactory, type FfprobeData } from "@toonflow/ffmpeg/browser";
import { useWorkspaceStore } from "@/stores/workspace";
import projectPicker from "@/components/projectPicker.vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";
const relativePath = z.string().max(4096).refine(path => !path || !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."));
const draftSchema = z.object({
  clips: z.array(z.object({ path: relativePath.min(1), name: z.string().max(512), start: z.number().finite().min(0), end: z.number().finite().min(0) })).max(100),
  ratio: z.enum(["16:9", "9:16", "1:1", "4:3"]), music: relativePath, voice: relativePath,
  subtitles: z.string().max(100000), musicVolume: z.number().finite().min(0).max(2), voiceVolume: z.number().finite().min(0).max(2), originalVolume: z.number().finite().min(0).max(2),
  exports: z.array(z.object({ path: relativePath.min(1), name: z.string().max(512), state: z.string().max(30) })).max(1000),
});
type Clip = { path: string; name: string; start: number; end: number };
type Export = { path: string; name: string; state: string };
const workspace = useWorkspaceStore(), route = useRoute(), router = useRouter();
const clips = ref<Clip[]>([]), exports = ref<Export[]>([]), ratio = ref("16:9"), music = ref(""), voice = ref(""), subtitles = ref("");
const musicVolume = ref(0.3), voiceVolume = ref(1), originalVolume = ref(1), processing = ref(false), error = ref(""), progress = ref("Đang chuẩn bị…");
const clipInput = ref<HTMLInputElement>(), musicInput = ref<HTMLInputElement>(), voiceInput = ref<HTMLInputElement>(), previewUrl = ref("");
let exportController: AbortController | undefined;
let previewHandle: ReturnType<ReturnType<typeof useWorkspaceFiles>["acquireUrl"]> | undefined;
function currentFiles() { if (!workspace.project) throw new Error("Chọn dự án trước"); return useWorkspaceFiles(workspace.project.directory); }
async function ensureFolder(path: string) { const files = currentFiles(); if (!(await files.list()).entries.some(entry => entry.name === path && entry.type === "directory")) await files.mkdir(path); }
async function upload(file: File) {
  if (!file.size || file.size > 100 * 1024 * 1024) throw new Error("Mỗi file phải từ 1 byte đến 100 MB.");
  await ensureFolder("postInputs"); const extension = file.name.split(".").at(-1)?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const path = `postInputs/${crypto.randomUUID()}.${extension}`; await currentFiles().write(path, file, true); return path;
}
async function uploadClips(event: Event) { const input = event.target as HTMLInputElement; try { for (const file of Array.from(input.files ?? [])) { if (!file.type.startsWith("video/")) throw new Error("Chọn file video"); clips.value.push({ path: await upload(file), name: file.name, start: 0, end: 0 }); } await saveDraft(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không thêm được video"; } input.value = ""; }
async function uploadAudio(event: Event, role: "music" | "voice") { const input = event.target as HTMLInputElement; try { const file = input.files?.[0]; if (!file || !file.type.startsWith("audio/")) return; const path = await upload(file); if (role === "music") music.value = path; else voice.value = path; await saveDraft(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không thêm được âm thanh"; } input.value = ""; }
function moveClip(index: number, delta: number) { const [clip] = clips.value.splice(index, 1); if (clip) clips.value.splice(index + delta, 0, clip); }
function draft() { return { clips: clips.value, ratio: ratio.value, music: music.value, voice: voice.value, subtitles: subtitles.value, musicVolume: musicVolume.value, voiceVolume: voiceVolume.value, originalVolume: originalVolume.value, exports: exports.value }; }
async function saveDraft() { if (!workspace.project) return; try { await currentFiles().writeJson("postDraft.json", draft()); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Chưa lưu được bản dựng"; throw cause; } }
async function load() {
  clips.value = []; exports.value = []; error.value = ""; previewHandle?.release(); previewUrl.value = "";
  if (!workspace.project) return;
  try {
    if ((await currentFiles().list()).entries.some(entry => entry.name === "postDraft.json")) {
      const saved = draftSchema.parse(await currentFiles().readJson("postDraft.json"));
      if (Array.isArray(saved.clips)) clips.value = saved.clips;
      if (Array.isArray(saved.exports)) exports.value = saved.exports;
      ratio.value = saved.ratio || "16:9"; music.value = saved.music || ""; voice.value = saved.voice || ""; subtitles.value = saved.subtitles || "";
      musicVolume.value = saved.musicVolume ?? 0.3; voiceVolume.value = saved.voiceVolume ?? 1; originalVolume.value = saved.originalVolume ?? 1;
    }
    if ((await currentFiles().list()).entries.some(entry => entry.name === "postWork" && entry.type === "directory")) {
      const folders = (await currentFiles().list("postWork")).entries.filter(entry => entry.type === "directory");
      for (const folder of folders.slice(-100)) {
        const recordPath = `postWork/${folder.name}/request.json`;
        const record = await currentFiles().readJson<{ state: string; path?: string }>(recordPath).catch(() => null);
        if (!record) continue;
        const path = `postWork/${folder.name}/thanhPham.mp4`;
        if (!exports.value.some(output => output.path === path)) exports.value.push({ path, name: `Bản xuất ${folder.name.slice(0, 8)}`, state: record.state === "succeeded" && record.path === path ? "succeeded" : "interrupted" });
      }
    }
    const path = typeof route.query.file === "string" ? route.query.file : "";
    if (path && !clips.value.some(clip => clip.path === path)) { await currentFiles().read(path); clips.value.push({ path, name: path.split("/").at(-1)!, start: 0, end: 0 }); await saveDraft(); }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không mở được bản dựng"; }
}
watch(() => workspace.project?.directory, load, { immediate: true });
function probe(ffmpeg: BrowserFfmpegFactory, path: string) { return new Promise<FfprobeData>((resolve, reject) => ffmpeg(path).ffprobe((failure, value) => failure ? reject(failure) : resolve(value))); }
function render(command: BrowserFfmpegCommand, path: string) { return new Promise<void>((resolve, reject) => { command.on("progress", value => { progress.value = value.percent ? `Đang xuất ${Math.round(value.percent)}%` : `Đang xuất ${value.timemark}`; }).on("end", () => resolve()).on("error", reject).save(path); }); }
async function restoreExport(path: string) {
  try {
    const value = draftSchema.parse(await currentFiles().readJson(path.replace(/thanhPham\.mp4$/, "request.json")));
    clips.value = value.clips; ratio.value = value.ratio; music.value = value.music; voice.value = value.voice; subtitles.value = value.subtitles;
    musicVolume.value = value.musicVolume; voiceVolume.value = value.voiceVolume; originalVolume.value = value.originalVolume;
    await saveDraft(); ElMessage.success("Đã khôi phục bản dựng. Bấm Xuất để tạo lượt mới; file cũ vẫn giữ nguyên.");
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không khôi phục được bản dựng"; }
}
async function exportVideo() {
  if (processing.value || !workspace.project || !clips.value.length) return;
  processing.value = true; error.value = ""; exportController = new AbortController();
  const directory = workspace.project.directory, files = useWorkspaceFiles(directory), id = crypto.randomUUID();
  try {
    const snapshot = draftSchema.parse(JSON.parse(JSON.stringify(draft())));
    await saveDraft(); await ensureFolder("postWork"); await files.mkdir(`postWork/${id}`);
    await files.writeJson(`postWork/${id}/request.json`, { ...snapshot, state: "running" }, true);
    const ffmpeg = await createBrowserFfmpeg(directory, exportController.signal);
    const prepared: { path: string; mimeType: string }[] = [];
    for (const [index, clip] of snapshot.clips.entries()) {
      exportController.signal.throwIfAborted(); progress.value = `Đang cắt clip ${index + 1}/${snapshot.clips.length}`;
      const info = await probe(ffmpeg, clip.path); const duration = Number(info.format.duration);
      const end = clip.end || duration;
      if (!Number.isFinite(duration) || !Number.isFinite(clip.start) || clip.start < 0 || end <= clip.start || end > duration) throw new Error(`Khoảng cắt không hợp lệ: ${clip.name}`);
      const path = `postWork/${id}/clip${index + 1}.mp4`;
      await render(ffmpeg(clip.path).seekInput(clip.start).duration(end - clip.start).videoCodec("libx264").audioCodec("aac").outputOptions("-pix_fmt yuv420p", "-movflags +faststart"), path);
      prepared.push({ path, mimeType: "video/mp4" });
    }
    progress.value = "Đang ghép clip theo thứ tự…";
    const response = await axios.post("/api/media/merge", { directory, clips: prepared, ratio: snapshot.ratio }, { headers: { "x-toonflow-workspace": "1" }, signal: exportController.signal });
    if (response.data.code !== 200) throw new Error(response.data.message);
    const merged = response.data.data.path as string;
    const finalPath = `postWork/${id}/thanhPham.mp4`, temporary = `postWork/${id}/thanhPham.partial.mp4`;
    const command = ffmpeg(merged);
    const inputs: { index: number; volume: number }[] = [{ index: 0, volume: snapshot.originalVolume }];
    if (snapshot.music) { command.input(snapshot.music).inputOptions("-stream_loop -1"); inputs.push({ index: inputs.length, volume: snapshot.musicVolume }); }
    if (snapshot.voice) { command.input(snapshot.voice); inputs.push({ index: inputs.length, volume: snapshot.voiceVolume }); }
    const filters = inputs.map(input => `[${input.index}:a:0]volume=${input.volume}[a${input.index}]`);
    filters.push(inputs.map(input => `[a${input.index}]`).join("") + `amix=inputs=${inputs.length}:duration=first:normalize=0[audio]`);
    if (snapshot.subtitles.trim()) {
      if (!/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(snapshot.subtitles)) throw new Error("Phụ đề cần đúng định dạng SRT.");
      const path = `postWork/${id}/subtitles.srt`; await files.write(path, snapshot.subtitles, true);
      command.videoFilter(`subtitles=filename='${path}'`);
    }
    progress.value = "Đang thêm âm thanh và phụ đề…";
    command.complexFilter(filters.join(";")).outputOptions("-map 0:v:0", "-map [audio]", "-shortest", "-pix_fmt yuv420p", "-movflags +faststart").videoCodec("libx264").audioCodec("aac");
    await render(command, temporary);
    const info = await probe(ffmpeg, temporary);
    if (!(Number(info.format.duration) > 0) || !info.streams.some(stream => stream.codec_type === "video")) throw new Error("File xuất chưa phải MP4 hợp lệ.");
    await files.rename(temporary, finalPath);
    await files.writeJson(`postWork/${id}/request.json`, { ...snapshot, state: "succeeded", path: finalPath });
    exports.value.unshift({ path: finalPath, name: `Thành phẩm ${new Date().toLocaleString('vi-VN')}`, state: "succeeded" });
    await saveDraft(); await preview(finalPath); ElMessage.success("Đã lưu MP4 thành phẩm. File gốc và clip trung gian vẫn được giữ.");
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Xuất video chưa hoàn tất"; }
  finally { processing.value = false; exportController = undefined; }
}
async function preview(path: string) { previewHandle?.release(); const handle = currentFiles().acquireUrl(path); previewHandle = handle; try { const url = await handle.url; if (previewHandle === handle) previewUrl.value = url; } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không xem được video"; } }
async function download(path: string) { const files = currentFiles(); try { await saveFile(async () => new Blob([await files.read(path)], { type: "video/mp4" }), "thanh-pham.mp4"); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không tải được MP4"; } }
onBeforeRouteLeave(async () => { if (processing.value) { try { await ElMessageBox.confirm("Rời phòng hậu kỳ sẽ dừng lượt xuất hiện tại. File gốc vẫn giữ nguyên.", "Đang xuất video", { confirmButtonText: "Dừng và rời", cancelButtonText: "Tiếp tục xuất", type: "warning" }); exportController?.abort(); } catch { return false; } } await saveDraft(); return true; });
onScopeDispose(() => { exportController?.abort(); previewHandle?.release(); });
</script>
<style scoped lang="scss">
.postStudio { padding: 24px; header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 24px; h1 { margin: 0; font-size: 24px; } p { color: var(--el-text-color-secondary); } } .postLayout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(300px, .8fr); gap: 20px; .editClip { padding: 18px 0; border-bottom: 1px solid var(--el-border-color); margin-bottom: 16px; strong { overflow-wrap: anywhere; } small { color: var(--el-text-color-secondary); } label { font-size: 12px; } } .postResults { display: grid; gap: 16px; align-content: start; video { width: 100%; max-height: 65vh; } } } }
@media (max-width: 1000px) { .postStudio .postLayout { grid-template-columns: 1fr; } }
</style>
