<template>
  <div class="projectPicker"><el-select :modelValue="workspace.project?.directory" :disabled="disabled || opening" placeholder="Chọn dự án lưu file" @change="openProject"><el-option v-for="project in workspace.projectList" :key="project.directory" :value="project.directory" :label="project.name" /></el-select><el-button :disabled="disabled" :loading="opening" @click="chooseProject">Mở / tạo thư mục dự án</el-button><workspacePicker ref="picker" hideTrigger /></div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useWorkspaceStore } from "@/stores/workspace";
import workspacePicker from "@/pages/home/workspacePicker.vue";
defineProps<{ disabled?: boolean }>();
const workspace = useWorkspaceStore(), picker = ref<InstanceType<typeof workspacePicker>>(), opening = ref(false);
async function openProject(directory: string) { opening.value = true; try { await workspace.openProject(directory); } catch (error) { ElMessage.error(error instanceof Error ? error.message : "Không mở được dự án"); } finally { opening.value = false; } }
async function chooseProject() { const directory = await picker.value?.chooseDirectory(); if (directory) await openProject(directory); }
</script>
<style scoped lang="scss">
.projectPicker { display: flex; gap: 12px; align-items: center; .el-select { width: min(360px, 40vw); } }
</style>
