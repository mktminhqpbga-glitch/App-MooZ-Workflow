import { addAsset, toDataURL } from "./core/storage.js";
export async function editImage(asset, onSaved) {
  if (asset.kind !== "image") throw Error("Chọn ảnh để chỉnh.");
  globalThis.MooZCVNMediaEditorTarget = {
    addMedia: async (output) => {
      const blob = await (await fetch(output.dataUrl)).blob();
      const result = await addAsset(
        new File([blob], output.name, { type: blob.type }),
        { projectId: asset.projectId, source: "local-edit" },
      );
      await onSaved?.(result);
    },
  };
  await globalThis.MooZImageEditor.open({
    nodeId: asset.id,
    name: asset.name,
    dataUrl: await toDataURL(asset.blob),
  });
}
export async function captureFrame(asset, time = 0) {
  if (asset.kind !== "video") throw Error("Chọn video để lấy khung hình.");
  const video = document.createElement("video"),
    url = URL.createObjectURL(asset.blob);
  video.muted = true;
  video.preload = "auto";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Không đọc được video trong 15 giây.")),
        15000,
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(Error("Video không đọc được trên trình duyệt này."));
      };
      video.src = url;
    });
    const capturedTime=Math.min(Math.max(0,time),Math.max(0,video.duration-.05));
    if (time > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Không tìm được khung hình.")),
          10000,
        );
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.currentTime = Math.min(
          Math.max(0, time),
          Math.max(0, video.duration - 0.05),
        );
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (
      !canvas.width ||
      !canvas.height ||
      canvas.width * canvas.height > 32 * 1024 * 1024
    )
      throw Error("Kích thước khung hình không phù hợp.");
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("Không xuất được khung hình.");
    return await addAsset(
      new File([blob], asset.name + " · " + capturedTime.toFixed(1) + "s.png", {
        type: "image/png",
      }),
      { projectId: asset.projectId, source: "video-frame" },
    );
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
