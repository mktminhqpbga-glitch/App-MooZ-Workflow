<template>
  <div class="studioShell" :class="{ canvasFullscreen: isCanvas }">
    <aside v-if="!isCanvas" class="studioSidebar" aria-label="Điều hướng chính">
      <router-link to="/home" class="studioBrand" aria-label="MooZ CVN trang chủ"><span class="brandMark">M</span><span class="brandText">MooZ CVN<small>WORKFLOW STUDIO</small></span></router-link>
      <span class="navLabel">KHÔNG GIAN LÀM VIỆC</span>
      <nav>
        <router-link v-for="item in modules" :key="item.path" :to="item.path" class="studioNavItem" :title="item.label" :class="{ selected: route.path === item.path }"><component :is="item.icon" :size="21" /><span>{{ item.label }}</span></router-link>
        <button class="studioNavItem" type="button" title="Kho tài nguyên chung" @click="assetsVisible = true"><icon-library-photo :size="21" /><span>Kho tài nguyên chung</span></button>
        <button class="studioNavItem" type="button" title="Cài đặt" @click="openSettings()"><icon-settings :size="21" /><span>Cài đặt</span></button>
        <button class="studioNavItem" type="button" title="Giao diện" @click="openSettings('general')"><icon-palette :size="21" /><span>Giao diện</span></button>
      </nav>
      <div class="sidebarBottom"><button class="connectionButton" type="button" title="Kết nối AI" @click="openSettings('mediaModel')"><icon-plug-connected :size="20" /><span>Kết nối AI<small>Chrome · Máy khác · VM · API</small></span></button><p>MooZ CVN <span>Ứng dụng cục bộ</span></p></div>
    </aside>
    <div class="studioWorkspace">
      <header v-if="!isCanvas" class="studioHeader"><router-link to="/home">Không gian làm việc</router-link><span>/</span><strong>{{ currentLabel }}</strong><span v-if="workspace.project" class="projectName">{{ workspace.project.name }}</span></header>
      <main class="studioContent"><slot /></main>
      <footer v-if="!isCanvas" class="studioFooter"><span>Một không gian cho mọi ý tưởng.</span><span>● Không gian cá nhân</span></footer>
    </div>
    <settings ref="settingsDialog" v-model="settingsVisible" />
    <assetLibraryDialog v-model="assetsVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, provide, ref } from "vue";
import { useRoute } from "vue-router";
import { IconLayoutDashboard, IconVector, IconPhoto, IconMovie, IconLibraryPhoto, IconSettings, IconPalette, IconPlugConnected } from "@tabler/icons-vue";
import settings from "@/components/settings/index.vue";
import assetLibraryDialog from "@/pages/home/assetLibraryDialog.vue";
import { useWorkspaceStore } from "@/stores/workspace";
const route = useRoute();
const workspace = useWorkspaceStore();
const settingsDialog = ref<InstanceType<typeof settings>>();
const settingsVisible = ref(false), assetsVisible = ref(false);
const isCanvas = computed(() => route.path === "/workspace");
const modules = computed(() => [
  { path: "/home", label: "Tổng quan", icon: IconLayoutDashboard },
  { path: workspace.project ? "/workspace" : "/home?section=projects", label: "Canvas", icon: IconVector },
  { path: "/images", label: "Tạo ảnh hàng loạt", icon: IconPhoto },
  { path: "/videos", label: "Tạo video hàng loạt", icon: IconMovie },
  { path: "/post", label: "Hậu kỳ", icon: IconMovie },
  { path: "/library", label: "Kho dự án", icon: IconLibraryPhoto },
]);
provide("openStudioSettings", openSettings);
const currentLabel = computed(() => modules.value.find(item => item.path === route.path)?.label ?? "Không gian sáng tạo");
async function openSettings(panel?: string) { settingsVisible.value = true; await nextTick(); if (panel) settingsDialog.value?.openPanel(panel); }
</script>

<style lang="scss">
// Presentation adapted from App-MooZ-Workflow/main c922c8c, retaining Toonflow controls.
.studioShell {
  --studioRail: 76px; --studioBg: #171819; --studioPanel: #202122; --studioLine: #343637; --studioInk: #eeefec; --studioMuted: #969b99; --studioAccent: #c3d2bb;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex; height: 100dvh; color: var(--studioInk); background: var(--studioBg);
  &:has(.studioSidebar:hover), &:has(.studioSidebar:focus-within) { --studioRail: 238px; }
  .studioSidebar { width: var(--studioRail); flex-shrink: 0; border-right: 1px solid var(--studioLine); padding: 28px 10px 16px; display: flex; flex-direction: column; transition: width .18s; overflow: hidden; .studioBrand { display: flex; gap: 12px; align-items: center; color: inherit; text-decoration: none; padding: 0 8px; .brandMark { display: grid; place-items: center; flex: 0 0 39px; width: 39px; height: 39px; border-radius: 11px; background: var(--studioAccent); color: #20291d; font-size: 28px; font-weight: 850; } .brandText { white-space: nowrap; font-size: 23px; font-weight: 650; letter-spacing: -1px; small { display: block; font-size: 8px; letter-spacing: 2px; color: var(--studioMuted); margin-top: 4px; } } } .navLabel { margin: 48px 12px 16px; height: 12px; font-size: 9px; letter-spacing: 1.4px; color: var(--studioMuted); white-space: nowrap; } nav { display: grid; gap: 6px; } .studioNavItem { display: flex; align-items: center; gap: 13px; padding: 12px 16px; border: 0; border-radius: 10px; color: var(--studioMuted); background: transparent; font: inherit; font-size: 13px; text-decoration: none; cursor: pointer; white-space: nowrap; svg { flex-shrink: 0; } &:hover { background: var(--studioPanel); color: var(--studioInk); } &.selected { background: #c3d2bb18; color: var(--studioAccent); } &:focus-visible { outline: 2px solid var(--studioAccent); outline-offset: 1px; } } .sidebarBottom { margin-top: auto; padding-top: 20px; .connectionButton { display: flex; gap: 12px; align-items: center; border: 1px solid var(--studioLine); border-radius: 12px; padding: 10px 16px; background: var(--studioPanel); color: inherit; width: 100%; cursor: pointer; white-space: nowrap; svg { flex-shrink: 0; } span { text-align: left; font-size: 12px; small { display: block; margin-top: 5px; color: var(--studioMuted); font-size: 10px; } } } p { color: var(--studioMuted); font-size: 10px; white-space: nowrap; padding: 0 8px; span { margin-left: 10px; } } } &:not(:hover):not(:focus-within) { .brandText, .navLabel, .studioNavItem > span, .connectionButton > span, .sidebarBottom p { visibility: hidden; } } }
  .studioWorkspace { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; .studioHeader { height: 44px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 24px; border-bottom: 1px solid var(--studioLine); font-size: 11px; color: var(--studioMuted); a { color: inherit; text-decoration: none; } strong { color: var(--studioInk); font-weight: 500; } .projectName { margin-left: auto; } } .studioContent { position: relative; flex: 1; min-height: 0; overflow: auto; } .studioFooter { display: flex; justify-content: space-between; flex-shrink: 0; padding: 10px 24px; color: var(--studioMuted); font-size: 10px; } }
  &.canvasFullscreen .studioWorkspace .studioContent { overflow: hidden; }
  .el-button--primary { --el-button-text-color: #20291d; --el-button-hover-text-color: #20291d; --el-button-active-text-color: #20291d; }
  .el-radio-button__original-radio:checked + .el-radio-button__inner { color: #20291d; }
  .home { height: 100%; grid-template-columns: minmax(0, 1fr); --sidebarWidth: 0px; .homeSidebar { display: none; } .pageScroll { grid-column: 1; } .pageBody { max-width: 1400px; } }
}
:root:not(.dark) .studioShell { --studioBg: #f4f4f0; --studioPanel: #ffffff; --studioLine: #d9dcd5; --studioInk: #292e26; --studioMuted: #747b70; --studioAccent: #516f43; }
</style>
