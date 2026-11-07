<template>
  <section class="projectLibrary"><header><div><h1>Kho dự án</h1><p>File gốc, ảnh/video đã tạo, clip trung gian và thành phẩm.</p></div><projectPicker /></header><template v-if="workspace.project"><el-space wrap><el-button :disabled="!folder" @click="goUp">Thư mục trên</el-button><el-button :loading="busy" @click="load">Làm mới</el-button><el-text>{{ folder || 'Thư mục gốc' }}</el-text></el-space><el-alert v-if="error" :title="error" type="error" :closable="false" /><div class="libraryGrid"><el-card v-for="entry in entries" :key="entry.path" shadow="never"><button v-if="entry.type === 'directory'" class="folderTile" @click="openFolder(entry.path)">📁<strong>{{ entry.name }}</strong><span>Mở thư mục</span></button><template v-else><el-image v-if="kind(entry.name) === 'image' && urls[entry.path]" :src="urls[entry.path]" fit="contain" :previewSrcList="[urls[entry.path]!]" class="libraryImage" /><video v-else-if="kind(entry.name) === 'video' && urls[entry.path]" :src="urls[entry.path]" controls preload="metadata" /><audio v-else-if="kind(entry.name) === 'audio' && urls[entry.path]" :src="urls[entry.path]" controls preload="metadata" /><el-button v-if="!urls[entry.path]" class="previewTile" @click="previewEntry(entry.path)">{{ kind(entry.name) === 'image' ? '📷 Xem ảnh' : kind(entry.name) === 'video' ? '🎞 Xem video' : '♫ Nghe âm thanh' }}</el-button><strong class="fileName">{{ entry.name }}</strong><el-space><el-button text @click="download(entry.path, entry.name)">Tải file</el-button><el-button v-if="kind(entry.name) === 'video'" text @click="router.push({ path: '/post', query: { file: entry.path } })">Đưa vào hậu kỳ</el-button></el-space></template></el-card></div></template><el-alert v-else title="Chọn thư mục dự án để mở kho file." type="info" :closable="false" /></section>
</template>
<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useWorkspaceStore } from "@/stores/workspace";
import projectPicker from "@/components/projectPicker.vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import saveFile from "@/lib/saveFile";
const workspace = useWorkspaceStore(), router = useRouter();
const folder = ref(""), entries = ref<{ name: string; path: string; type: "file" | "directory" }[]>([]), urls = ref<Record<string, string>>({}), busy = ref(false), error = ref("");
let generation = 0;
const handles = new Map<string, ReturnType<ReturnType<typeof useWorkspaceFiles>["acquireUrl"]>>();
function release() { generation++; for (const handle of handles.values()) handle.release(); handles.clear(); urls.value = {}; }
function kind(name: string) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(name) ? "image" : /\.(mp4|mov|webm|mkv)$/i.test(name) ? "video" : /\.(mp3|wav|m4a|ogg|aac)$/i.test(name) ? "audio" : "file"; }
async function load() {
  release(); const version = generation; const directory = workspace.project?.directory; if (!directory) return;
  busy.value = true; error.value = "";
  try {
    const files = useWorkspaceFiles(directory); const listing = await files.list(folder.value);
    if (version !== generation) return;
    entries.value = listing.entries.filter(entry => entry.type === "directory" || kind(entry.name) !== "file").slice(0, 100);

  } catch (cause) { if (version === generation) error.value = cause instanceof Error ? cause.message : "Không đọc được kho file"; }
  finally { if (version === generation) busy.value = false; }
}
async function previewEntry(path: string) {
  const directory = workspace.project?.directory; if (!directory || handles.has(path)) return;
  const version = generation;
  if (handles.size >= 4) { const key = handles.keys().next().value!; handles.get(key)?.release(); handles.delete(key); delete urls.value[key]; }
  const handle = useWorkspaceFiles(directory).acquireUrl(path); handles.set(path, handle);
  try { const url = await handle.url; if (version === generation && handles.get(path) === handle) urls.value[path] = url; }
  catch (cause) { handle.release(); if (handles.get(path) === handle) { handles.delete(path); error.value = cause instanceof Error ? cause.message : "Không xem được file"; } }
}
function openFolder(path: string) { folder.value = path; void load(); }
function goUp() { folder.value = folder.value.split("/").slice(0, -1).join("/"); void load(); }
async function download(path: string, name: string) { const files = useWorkspaceFiles(workspace.project!.directory); try { await saveFile(async () => new Blob([await files.read(path)]), name); } catch (cause) { error.value = cause instanceof Error ? cause.message : "Không tải được file"; } }
watch(() => workspace.project?.directory, () => { folder.value = ""; void load(); }, { immediate: true });
onScopeDispose(release);
</script>
<style scoped lang="scss">
.projectLibrary { padding: 24px; header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 24px; h1 { margin: 0; font-size: 24px; } p { color: var(--el-text-color-secondary); } } .libraryGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-top: 20px; .folderTile { display: grid; place-items: center; gap: 12px; width: 100%; min-height: 150px; border: 0; background: transparent; color: inherit; cursor: pointer; } .previewTile { width: 100%; min-height: 120px; } .fileName { display: block; overflow-wrap: anywhere; margin: 12px 0; font-size: 12px; } video, audio, .libraryImage { width: 100%; height: 150px; object-fit: contain; } } }
</style>
