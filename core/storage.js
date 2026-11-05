const DB = "mooz-cvn-content";
let pending;
export function contentDB() {
  return (pending ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 3);
    r.onupgradeneeded = () => {
      for (const name of [
        "inputs",
        "results",
        "prompts",
        "jobs",
        "templates",
        "characters",
      ])
        if (!r.result.objectStoreNames.contains(name))
          r.result.createObjectStore(name, { keyPath: "id" });
      if (r.result.objectStoreNames.contains("assets")) {
        const store = r.transaction.objectStore("assets");
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const value = cursor.value;
          r.transaction
            .objectStore(value.source === "upload" ? "inputs" : "results")
            .put(value);
          cursor.delete();
          cursor.continue();
        };
      }
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        pending = null;
      };
      resolve(r.result);
    };
    r.onerror = () => {
      pending = null;
      reject(r.error);
    };
  }));
}
export async function write(store, value) {
  const db = await contentDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(structuredClone(value));
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Không lưu được dữ liệu."));
  });
}
export async function list(store) {
  const db = await contentDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function read(store, id) {
  const db = await contentDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function remove(store, id) {
  const db = await contentDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function addAsset(
  file,
  { projectId = null, source = "upload" } = {},
) {
  if (
    !file.size ||
    file.size > 100 * 1024 * 1024 ||
    !/^((image\/(png|jpeg|webp|gif))|(video\/(mp4|webm|quicktime))|(audio\/(mpeg|wav|ogg|mp4|webm)))$/.test(
      file.type,
    )
  )
    throw Error(
      "Chọn ảnh PNG/JPG/WebP/GIF, video MP4/WebM/MOV hoặc âm thanh, tối đa 100 MB.",
    );
  await verifyMedia(file);
  const asset = {
    id: crypto.randomUUID(),
    name: (file.name || "Kết quả AI").slice(0, 200),
    kind: file.type.split("/")[0],
    type: file.type,
    size: file.size,
    blob: file,
    projectId,
    source,
    createdAt: new Date().toISOString(),
  };
  await write(source === "upload" ? "inputs" : "results", asset);
  return asset;
}
export const toDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export async function readAsset(id) {
  return (await read("inputs", id)) || (await read("results", id));
}
export async function listAssets() {
  return [...(await list("inputs")), ...(await list("results"))];
}

export async function verifyMedia(file) {
  if (file.type.startsWith("image/")) {
    let image;
    try {
      image = await createImageBitmap(file);
      if (!image.width || !image.height) throw Error();
    } catch {
      throw Error("Không đọc được ảnh. Kiểm tra tệp gốc.");
    } finally {
      image?.close();
    }
    return;
  }
  await new Promise((resolve, reject) => {
    const media = document.createElement(
        file.type.startsWith("video/") ? "video" : "audio",
      ),
      url = URL.createObjectURL(file),
      timer = setTimeout(
        () =>
          finish(
            Error(
              "Không đọc được media trong 15 giây. Thử MP4/WebM hoặc tệp khác.",
            ),
          ),
        15000,
      );
    function finish(error) {
      clearTimeout(timer);
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    }
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      finish();
    };
    media.onerror = () => {
      media.onerror = null;
      finish(Error("Trình duyệt không đọc được định dạng media này."));
    };
    media.src = url;
  });
}
