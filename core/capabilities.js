// A tool is shown only when its implementation exists. Service names alone are
// not evidence that region editing, AI HD, layers or panorama are supported.
export const localImageTools = Object.freeze([
  { label: "Chỉnh ảnh", icon: "edit", mode: "edit" },
  { label: "Chia lưới", icon: "grid", mode: "grid" },
  { label: "Xoay", icon: "rotate", mode: "rotate" },
  { label: "Vẽ", icon: "draw", mode: "draw" },
  { label: "Xem lớn", icon: "expand", mode: "view" },
]);
export const advancedImageOperations = Object.freeze({
  "image.upscale": "HD AI",
  "image.region-edit": "Chỉnh vùng AI",
  "image.multiview": "Nhiều góc nhìn",
  "image.layers": "Tách lớp AI",
  "image.panorama": "Tạo panorama",
});
export function readyOperations(status) {
  return new Set(
    (status?.providers || [])
      .filter((p) => p.ready)
      .flatMap((p) => (Array.isArray(p.operations) ? p.operations : [])),
  );
}
// Advanced handlers will be registered with the concrete provider adapter.
// No placeholder handler or client-side switch can enable a missing tool.
export function availableImageTools(status, handlers = {}) {
  const ready = readyOperations(status);
  return [
    ...localImageTools,
    ...Object.entries(advancedImageOperations)
      .filter(
        ([operation]) =>
          ready.has(operation) && typeof handlers[operation] === "function",
      )
      .map(([operation, label]) => ({
        label,
        mode: operation,
        icon: "edit",
        handler: handlers[operation],
      })),
  ];
}
