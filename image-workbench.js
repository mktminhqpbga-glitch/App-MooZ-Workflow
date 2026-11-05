import { addAsset } from "./core/storage.js";
import { el, button, notice } from "./client-api.js";
import { editImage } from "./media-tools.js";
async function source(asset) {
  const bitmap = await createImageBitmap(asset.blob);
  if (bitmap.width * bitmap.height > 32 * 1024 * 1024) {
    bitmap.close();
    throw Error("Ảnh tối đa 32 megapixel.");
  }
  return bitmap;
}
async function save(canvas, asset, suffix) {
  if (
    canvas.width > 8192 ||
    canvas.height > 8192 ||
    canvas.width * canvas.height > 32 * 1024 * 1024
  )
    throw Error("Ảnh xuất tối đa 8.192px và 32 megapixel.");
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw Error("Không xuất được ảnh.");
  return addAsset(
    new File(
      [blob],
      asset.name.replace(/\.[^.]+$/, "") + " · " + suffix + ".png",
      { type: "image/png" },
    ),
    { projectId: asset.projectId, source: "local-edit" },
  );
}
export async function transformImage(asset, { rotate = 0, scale = 1 } = {}) {
  const b = await source(asset);
  try {
    const c = document.createElement("canvas"),
      quarter = Math.abs(rotate) % 180 === 90,
      w = Math.round((quarter ? b.height : b.width) * scale),
      h = Math.round((quarter ? b.width : b.height) * scale);
    if (w > 8192 || h > 8192 || w * h > 32 * 1024 * 1024)
      throw Error("Ảnh xuất quá lớn.");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.translate(w / 2, h / 2);
    x.rotate((rotate * Math.PI) / 180);
    x.drawImage(
      b,
      (-b.width * scale) / 2,
      (-b.height * scale) / 2,
      b.width * scale,
      b.height * scale,
    );
    return await save(
      c,
      asset,
      rotate ? "Xoay " + rotate + "°" : "Phóng " + scale + "x",
    );
  } finally {
    b.close();
  }
}
export async function openImageTool(asset, mode, { onResult = () => {} } = {}) {
  if (asset.kind !== "image") throw Error("Chọn ảnh để sử dụng công cụ.");
  if (mode === "edit") return editImage(asset, onResult);
  if (mode === "rotate") {
    const output = await transformImage(asset, { rotate: 90 });
    await onResult(output);
    return;
  }
  const bitmap = await source(asset),
    dialog = el("dialog", undefined, "image-workbench"),
    heading = el("header"),
    content = el("section"),
    actions = el("footer");
  const names = {
    view: "Xem ảnh",
    grid: "Chia ảnh theo lưới",
    draw: "Vẽ và đánh dấu",
  };
  heading.append(
    el("h2", names[mode] || "Công cụ ảnh"),
    button("×", () => dialog.close()),
  );
  dialog.append(heading, content, actions);
  let url;
  const picture = () => {
    const img = el("img");
    url ||= URL.createObjectURL(asset.blob);
    img.src = url;
    img.alt = asset.name;
    return img;
  };
  dialog.onclose = () => {
    bitmap.close();
    if (url) URL.revokeObjectURL(url);
    dialog.remove();
  };
  document.body.append(dialog);
  dialog.showModal();
  if (mode === "view") {
    content.append(picture());
    actions.append(el("span", bitmap.width + " × " + bitmap.height));
    return;
  }
  if (mode === "grid") {
    const select = el("select");
    select.setAttribute("aria-label", "Kích thước lưới");
    for (const n of [2, 3, 4]) select.add(new Option(n + " × " + n, n));
    const tiles = el("div", undefined, "grid-preview"),
      selected = new Set();
    function render() {
      tiles.replaceChildren();
      selected.clear();
      const count = Number(select.value);
      tiles.style.gridTemplateColumns = `repeat(${count},1fr)`;
      for (let i = 0; i < count * count; i++) {
        selected.add(i);
        const tile = button(
          "",
          () => {
            selected.has(i) ? selected.delete(i) : selected.add(i);
            tile.setAttribute("aria-pressed", String(selected.has(i)));
          },
          "grid-tile",
        );
        tile.setAttribute("aria-label", "Ô " + (i + 1));
        tile.setAttribute("aria-pressed", "true");
        const c = el("canvas");
        c.width = 180;
        c.height = Math.round((180 * bitmap.height) / bitmap.width);
        c.getContext("2d").drawImage(
          bitmap,
          ((i % count) * bitmap.width) / count,
          (Math.floor(i / count) * bitmap.height) / count,
          bitmap.width / count,
          bitmap.height / count,
          0,
          0,
          c.width,
          c.height,
        );
        tile.append(c, el("span", String(i + 1)));
        tiles.append(tile);
      }
    }
    select.onchange = render;
    content.append(select, tiles);
    render();
    actions.append(
      button("Đưa ô đã chọn lên canvas", async () => {
        if (!selected.size) throw Error("Chọn ít nhất một ô.");
        const count = Number(select.value);
        for (const i of [...selected].sort((a, b) => a - b)) {
          const x = Math.floor(((i % count) * bitmap.width) / count),
            y = Math.floor((Math.floor(i / count) * bitmap.height) / count),
            right = Math.floor((((i % count) + 1) * bitmap.width) / count),
            bottom = Math.floor(
              ((Math.floor(i / count) + 1) * bitmap.height) / count,
            ),
            c = el("canvas");
          c.width = right - x;
          c.height = bottom - y;
          c.getContext("2d").drawImage(
            bitmap,
            x,
            y,
            c.width,
            c.height,
            0,
            0,
            c.width,
            c.height,
          );
          await onResult(await save(c, asset, "Ô " + (i + 1)));
        }
        dialog.close();
      }),
    );
    return;
  }
  if (mode === "draw") {
    const canvas = el("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.setAttribute("aria-label", "Vùng vẽ chú thích");
    canvas.style.touchAction = "none";
    const x = canvas.getContext("2d"),
      color = el("input");
    color.type = "color";
    color.value = "#f24e4e";
    color.setAttribute("aria-label", "Màu đánh dấu");
    const reset = () => {
      x.clearRect(0, 0, canvas.width, canvas.height);
      x.drawImage(bitmap, 0, 0);
    };
    reset();
    let previous = null;
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) * canvas.width) / r.width,
        y: ((e.clientY - r.top) * canvas.height) / r.height,
      };
    };
    canvas.onpointerdown = (e) => {
      previous = point(e);
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!previous) return;
      const next = point(e);
      x.strokeStyle = color.value;
      x.lineWidth = Math.max(2, bitmap.width / 200);
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(previous.x, previous.y);
      x.lineTo(next.x, next.y);
      x.stroke();
      previous = next;
    };
    canvas.onpointerup = canvas.onpointercancel = () => (previous = null);
    content.append(
      el("p", "Kéo để vẽ chú thích. Bản gốc được giữ nguyên."),
      color,
      canvas,
    );
    actions.append(
      button("Đặt lại", reset),
      button("Lưu ảnh đánh dấu", async () => {
        await onResult(await save(canvas, asset, "Đánh dấu"));
        dialog.close();
      }),
    );
    return;
  }
  content.append(el("p", "Công cụ chưa hỗ trợ."));
}
