import { exportBundle, importBundle } from "./core/backup.js";
import { remove } from "./core/storage.js";
import {
  ProjectRepository,
  createProject,
  exportProject,
  importProject,
} from "./core/projects.js";
const repository = new ProjectRepository();
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const button = (text, fn) => {
  const b = el("button", text);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (e) {
      notice(e.message);
    } finally {
      b.disabled = false;
    }
  };
  return b;
};
function notice(message) {
  const host = document.getElementById("toast");
  host.textContent = message;
  host.hidden = false;
  setTimeout(() => {
    if (host.textContent === message) host.hidden = true;
  }, 5000);
}
function nameDialog(title, value, submit) {
  const dialog = el("dialog"),
    form = el("form"),
    heading = el("h2", title),
    label = el("label", "Tên dự án"),
    input = el("input"),
    error = el("p", undefined, "project-error"),
    actions = el("div", undefined, "project-actions");
  input.required = true;
  input.maxLength = 100;
  input.value = value;
  input.name = "projectName";
  label.append(input);
  error.setAttribute("role", "status");
  const cancel = button("Hủy", () => dialog.close()),
    save = el("button", "Lưu dự án");
  save.type = "submit";
  actions.append(cancel, save);
  form.append(heading, label, error, actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    save.disabled = true;
    cancel.disabled = true;
    try {
      await submit(input.value);
      dialog.close();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      save.disabled = false;
      cancel.disabled = false;
    }
  };
  dialog.append(form);
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
}
export function mountProjects(host) {
  if (!host) return;
  host.replaceChildren();
  const head = el("div", undefined, "section-title");
  head.append(el("h2", "Dự án của bạn"));
  const actions = el("div", undefined, "project-actions");
  actions.append(
    button("Nhập dự án", () => {
      const file = el("input");
      file.type = "file";
      file.accept = ".json,application/json";
      file.onchange = async () => {
        try {
          const chosen = file.files[0];
          if (!chosen) return;
          if (chosen.size > 150 * 1024 * 1024)
            throw Error("Tệp sao lưu tối đa 150 MB.");
          const text = await chosen.text(),
            format = JSON.parse(text).format;
          let project,
            created = [];
          if (format === "mooz-cvn-bundle") {
            const result = await importBundle(text);
            project = result.project;
            created = result.created;
          } else project = importProject(text);
          try {
            await repository.save(project, { create: true });
          } catch (e) {
            for (const a of created)
              await remove(a.source === "upload" ? "inputs" : "results", a.id);
            throw e;
          }
          notice("Đã nhập bản sao dự án");
          mountProjects(host);
        } catch (e) {
          notice(e.message);
        }
      };
      file.click();
    }),
    button("＋ Tạo dự án", () =>
      nameDialog("Tạo dự án", "Dự án mới", async (name) => {
        const p = await repository.save(createProject(name), { create: true });
        location.hash = "project/" + p.id;
      }),
    ),
  );
  head.append(actions);
  const list = el("div", undefined, "project-list");
  host.append(head, list);
  list.textContent = "Đang đọc dự án…";
  void repository
    .list()
    .then((projects) => {
      if (!host.isConnected) return;
      list.replaceChildren();
      if (!projects.length) {
        list.append(
          el(
            "p",
            "Chưa có dự án. Tạo dự án đầu tiên hoặc nhập bản sao JSON.",
            "muted",
          ),
        );
        return;
      }
      for (const p of projects) {
        const link = el("a", undefined, "project-card");
        link.href = "#project/" + encodeURIComponent(p.id);
        link.append(
          el("span", "▤", "project-glyph"),
          el("strong", p.name),
          el("small", new Date(p.updatedAt).toLocaleString("vi-VN")),
          el("span", "Mở dự án →"),
        );
        list.append(link);
      }
    })
    .catch((e) => {
      if (list.isConnected)
        list.textContent = "Chưa đọc được dữ liệu: " + e.message;
    });
}
export async function mountProject(host, id) {
  try {
    const project = await repository.get(id);
    if (!host.isConnected) return;
    if (!project) {
      host.textContent = "Không tìm thấy dự án trên trình duyệt này.";
      return;
    }
    host.replaceChildren();
    const top = el("div", undefined, "section-title");
    top.append(el("h2", project.name));
    const actions = el("div", undefined, "project-actions");
    actions.append(
      button("Sao lưu kèm media", async () => {
        const blob = new Blob([await exportBundle(project)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = el("a");
        a.href = url;
        a.download = "MooZ-CVN-backup-" + project.id + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
      button("Mở Canvas", () => (location.hash = "canvas/" + id)),
      button("Đổi tên", () =>
        nameDialog("Đổi tên dự án", project.name, async (name) => {
          await repository.save({ ...project, name });
          await mountProject(host, id);
        }),
      ),
      button("Nhân bản", async () => {
        const copy = createProject(project.name.slice(0, 90) + " · Bản sao");
        copy.graph = structuredClone(project.graph);
        await repository.save(copy, { create: true });
        location.hash = "project/" + copy.id;
      }),
      button("Xuất JSON", () => {
        const blob = new Blob([exportProject(project)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = el("a");
        a.href = url;
        a.download = "MooZ-CVN-" + project.id + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
    top.append(actions);
    const counts = el("div", undefined, "project-stats");
    for (const [name, value] of [
      ["Node", project.graph.nodes.length],
      ["Dây nối", project.graph.edges.length],
      ["Nhóm", project.graph.groups.length],
    ]) {
      const stat = el("div");
      stat.append(el("strong", String(value)), el("span", name));
      counts.append(stat);
    }
    const note = el(
      "p",
      "Dự án đã được lưu cục bộ. Phần chỉnh sửa canvas sẽ được nối vào dữ liệu này ở bước tiếp theo.",
      "intro",
    );
    host.append(top, counts, note, el("p", "ID: " + project.id, "project-id"));
  } catch (e) {
    if (host.isConnected) host.textContent = "Chưa mở được dự án: " + e.message;
  }
}
