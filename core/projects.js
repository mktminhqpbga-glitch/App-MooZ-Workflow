import { emptyGraph, validateGraph } from "./graph.js";
export const schemaVersion = 1;
const validateName = (value) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw Error("Tên dự án cần từ 1 đến 100 ký tự.");
  return value.trim();
};
const validateDescription = (value = "") => {
  if (typeof value !== "string" || value.length > 2000)
    throw Error("Mô tả workflow tối đa 2.000 ký tự.");
  return value.trim();
};
export function createProject(name, description = "") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion,
    name: validateName(name),
    description: validateDescription(description),
    createdAt: now,
    lastOpenedAt: null,
    updatedAt: now,
    revision: 1,
    graph: emptyGraph(),
  };
}
export function exportProject(project) {
  return JSON.stringify(
    {
      format: "mooz-cvn-project",
      schemaVersion,
      name: validateName(project.name),
      description: validateDescription(project.description),
      ...(project.importId?{importId:String(project.importId).slice(0,100)}:{}),
      graph: validateGraph(project.graph),
    },
    null,
    2,
  );
}
export function importProject(text) {
  if (typeof text !== "string" || text.length > 5 * 1024 * 1024)
    throw Error("Tệp dự án tối đa 5 MB.");
  const data = JSON.parse(text);
  if (
    data.format !== "mooz-cvn-project" ||
    data.schemaVersion !== schemaVersion
  )
    throw Error("Định dạng hoặc phiên bản dự án chưa hỗ trợ.");
  const project = createProject(data.name, data.description);
  project.graph = validateGraph(data.graph);
  return project;
}
// IndexedDB commits whole records atomically. Optimistic revisions reject stale writers.
export class ProjectRepository {
  #db;
  async open() {
    if (this.#db) return;
    this.#db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("mooz-cvn-projects", 2);
      r.onupgradeneeded = () => {
        const store = r.result.objectStoreNames.contains("projects")
          ? r.transaction.objectStore("projects")
          : r.result.createObjectStore("projects", { keyPath: "id" });
        if (!store.indexNames.contains("updatedAt"))
          store.createIndex("updatedAt", "updatedAt");
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          this.#db = null;
        };
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(Error("Đóng các tab MooZ CVN cũ để cập nhật kho dự án."));
    });
  }
  async list() {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction("projects"),
        r = tx.objectStore("projects").getAll();
      r.onsuccess = () =>
        resolve(
          r.result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      r.onerror = () => reject(r.error);
    });
  }
  async get(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const r = this.#db
        .transaction("projects")
        .objectStore("projects")
        .get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async listPage(page = 1, pageSize = 10) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw Error("Trang workflow không hợp lệ.");
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction("projects"),
        store = tx.objectStore("projects"),
        count = store.count(),
        items = [];
      let total = 0, currentPage = 1;
      count.onsuccess = () => {
        total = count.result;
        currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        if (!total) return;
        const request = store.index("updatedAt").openCursor(null, "prev");
        let skip = (currentPage - 1) * pageSize;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (skip) {
            const offset = skip;
            skip = 0;
            cursor.advance(offset);
            return;
          }
          items.push(cursor.value);
          if (items.length < pageSize) cursor.continue();
        };
      };
      tx.oncomplete = () => resolve({ items, total, page: currentPage, pageSize });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Chưa tải được trang workflow."));
    });
  }
  async save(project, { create = false } = {}) {
    await this.open();
    const clean = {
      id: project.id,
      schemaVersion,
      name: validateName(project.name),
      description: validateDescription(project.description),
      ...(project.importId?{importId:String(project.importId).slice(0,100)}:{}),
      lastOpenedAt: project.lastOpenedAt || null,
      graph: validateGraph(project.graph),
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      revision: project.revision,
    };
    if (
      typeof clean.id !== "string" ||
      !clean.id ||
      !Number.isInteger(clean.revision) ||
      clean.revision < 1
    )
      throw Error("Dự án không hợp lệ.");
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction("projects", "readwrite"),
        store = tx.objectStore("projects"),
        read = store.get(clean.id);
      let error;
      read.onsuccess = () => {
        const old = read.result;
        if (create ? !!old : !old || old.revision !== clean.revision) {
          error = Error(
            "Dự án đã thay đổi ở tab khác. Hãy tải lại trước khi lưu.",
          );
          tx.abort();
          return;
        }
        clean.revision = create ? 1 : old.revision + 1;
        if (old?.lastOpenedAt && (!clean.lastOpenedAt || old.lastOpenedAt > clean.lastOpenedAt))
          clean.lastOpenedAt = old.lastOpenedAt;
        store.put(clean);
      };
      tx.oncomplete = () => resolve(structuredClone(clean));
      tx.onerror = () => reject(error || tx.error);
      tx.onabort = () =>
        reject(error || tx.error || Error("Chưa lưu được dự án."));
    });
  }
  async markOpened(id) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction("projects", "readwrite"), store = tx.objectStore("projects"), request = store.get(id);
      let project;
      request.onsuccess = () => {
        project = request.result;
        if (!project) return;
        // Visiting changes metadata only, never the graph revision used by editors.
        project.lastOpenedAt = new Date().toISOString();
        store.put(project);
      };
      tx.oncomplete = () => resolve(project);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Chưa ghi nhận được lần mở dự án."));
    });
  }
  async delete(id, revision) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction("projects", "readwrite"),
        store = tx.objectStore("projects"),
        request = store.get(id);
      let error;
      request.onsuccess = () => {
        if (!request.result || request.result.revision !== revision) {
          error = Error("Workflow đã thay đổi. Hãy tải lại danh sách trước khi xóa.");
          tx.abort();
          return;
        }
        store.delete(id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(error || tx.error);
      tx.onabort = () => reject(error || tx.error || Error("Chưa xóa được workflow."));
    });
  }
}
