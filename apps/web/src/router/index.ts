import { createRouter, createWebHashHistory } from "vue-router";
import { useWorkspaceStore } from "@/stores/workspace";
import { publicWeb } from "@/stores/multiTenant";
import { adminRoute } from "@/pages/multiTenant/router";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/home",
    },
    {
      path: "/hello",
      redirect: "/home",
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    { path: "/post", component: () => import("@/pages/postStudio/index.vue") },
    { path: "/library", component: () => import("@/pages/library/index.vue") },
    { path: "/images", component: () => import("@/pages/batchStudio/index.vue"), props: { mediaType: "image" } },
    { path: "/videos", component: () => import("@/pages/batchStudio/index.vue"), props: { mediaType: "video" } },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      beforeEnter: () => publicWeb.value && !useWorkspaceStore().project ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/workspace/index.vue"),
    },
    adminRoute,
  ],
});
export default router;
