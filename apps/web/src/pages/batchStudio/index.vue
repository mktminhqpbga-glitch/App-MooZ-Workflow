<template>
  <section class="batchStudio">
    <header class="projectToolbar"><strong>{{ mediaType === 'image' ? 'Xưởng ảnh' : 'Xưởng video' }}</strong><el-select :modelValue="workspace.project?.directory" placeholder="Chọn dự án lưu file" @change="openProject"><el-option v-for="project in workspace.projectList" :key="project.directory" :value="project.directory" :label="project.name" /></el-select><el-button :loading="opening" @click="chooseProject">Mở / tạo thư mục dự án</el-button></header>
    <batchPanel v-if="workspace.project" :key="`${workspace.project.directory}:${mediaType}`" :mediaType="mediaType" />
    <el-alert v-else class="projectNotice" title="Chọn hoặc tạo thư mục dự án để lưu đầu vào, hàng đợi và thành phẩm. Không cần mở Canvas." type="info" :closable="false" />
    <workspacePicker ref="picker" hideTrigger />
  </section>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useWorkspaceStore } from "@/stores/workspace";
import batchPanel from "@/pages/workspace/panels/batch/index.vue";
import workspacePicker from "@/pages/home/workspacePicker.vue";
defineProps<{ mediaType: "image" | "video" }>();
const workspace = useWorkspaceStore();
const picker = ref<InstanceType<typeof workspacePicker>>();
const opening = ref(false);
async function openProject(directory: string) { opening.value = true; try { await workspace.openProject(directory); } catch (error) { ElMessage.error(error instanceof Error ? error.message : "Không mở được dự án"); } finally { opening.value = false; } }
async function chooseProject() { const directory = await picker.value?.chooseDirectory(); if (directory) await openProject(directory); }
</script>
<style scoped lang="scss">
.batchStudio { height: 100%; display: flex; flex-direction: column; min-height: 0; .projectToolbar { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 16px 24px 0; .el-select { max-width: 360px; } } :deep(.batchPanel) { position: relative; flex: 1; min-height: 0; padding: 24px; } .projectNotice { margin: 32px; width: auto; } }
</style>
