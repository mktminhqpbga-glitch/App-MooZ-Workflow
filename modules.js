import { editImage, captureFrame } from "./media-tools.js";
import { el, button, notice, api, providerList } from "./client-api.js";
import {
  list,
  read,
  write,
  remove,
  addAsset,
  readAsset,
} from "./core/storage.js";
import { ProjectRepository } from "./core/projects.js";
import {
  createJob,
  startJob,
  stopJob,
  inspectJob,
  recoverJobs,
} from "./core/runner.js";
import { emptyGraph } from "./core/graph.js";
const repo = new ProjectRepository(),
  titles = {
    inputs: "Đầu vào",
    results: "Kết quả",
    prompts: "Prompt",
    templates: "Luồng mẫu",
  };
export async function mountLibrary(host) {
  let category = "inputs",
    kind = "all",
    query = "",
    alive = true,
    urls = [];
  const top = el("div", undefined, "section-title");
  top.append(el("h1", "Kho"));
  const tabs = el("nav", undefined, "library-tabs");
  tabs.setAttribute("aria-label", "Các khu trong Kho");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Tìm trong khu đang mở…";
  search.setAttribute("aria-label", "Tìm trong Kho");
  const filter = el("select");
  for (const [v, l] of [
    ["all", "Tất cả loại"],
    ["image", "Ảnh"],
    ["video", "Video"],
    ["audio", "Âm thanh"],
  ])
    filter.add(new Option(l, v));
  const tools = el("div", undefined, "project-actions"),
    cards = el("div", undefined, "library-grid");
  const uploader = el("input");
  uploader.type = "file";
  uploader.multiple = true;
  uploader.accept = "image/*,video/*,audio/*";
  uploader.hidden = true;
  uploader.onchange = async () => {
    try {
      for (const file of uploader.files) await addAsset(file);
      await render();
    } catch (e) {
      notice(e.message);
    }
    uploader.value = "";
  };
  const create = button("＋ Tải đầu vào", () => uploader.click());
  tools.append(search, filter, create, uploader);
  host.replaceChildren(top, tabs, tools, cards);
  for (const [key, label] of Object.entries(titles)) {
    const b = button(label, async () => {
      category = key;
      query = "";
      search.value = "";
      await render();
    });
    b.dataset.category = key;
    tabs.append(b);
  }
  search.oninput = () => {
    query = search.value.toLowerCase();
    void render();
  };
  filter.onchange = () => {
    kind = filter.value;
    void render();
  };
  let revision = 0;
  async function render() {
    const seq = ++revision,
      items = await list(category);
    if (!alive || seq !== revision) return;
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    cards.replaceChildren();
    filter.hidden = !["inputs", "results"].includes(category);
    create.hidden = category !== "inputs" && category !== "prompts";
    create.textContent =
      category === "inputs" ? "＋ Tải đầu vào" : "＋ Lưu prompt";
    create.onclick = async () => {
      if (category === "inputs") uploader.click();
      else promptDialog(null);
    };
    for (const b of tabs.children)
      b.setAttribute(
        "aria-current",
        b.dataset.category === category ? "page" : "false",
      );
    for (const item of items
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .filter(
        (a) =>
          a.name.toLowerCase().includes(query) &&
          (!["inputs", "results"].includes(category) ||
            kind === "all" ||
            a.kind === kind),
      )) {
      const card = el("article", undefined, "library-card");
      if (item.blob) {
        const visual = el(item.kind === "image" ? "img" : item.kind);
        visual.src = URL.createObjectURL(item.blob);
        urls.push(visual.src);
        if (item.kind !== "image") {
          visual.controls = true;
          visual.preload = "metadata";
        } else visual.alt = item.name;
        card.append(visual);
      } else
        card.append(
          el(
            "p",
            category === "prompts"
              ? item.text
              : (item.graph?.nodes.length || 0) +
                  " node · " +
                  (item.graph?.edges.length || 0) +
                  " dây",
            "library-text",
          ),
        );
      card.append(el("strong", item.name));
      const actions = el("div", undefined, "project-actions");
      actions.append(
        button("Đổi tên", () => {
          const next = prompt("Tên mới", item.name);
          if (next?.trim()) {
            return write(category, {
              ...item,
              name: next.trim().slice(0, 100),
            }).then(render);
          }
        }),
      );
      if (item.kind === "image")
        actions.append(
          button("Chỉnh ảnh", () => editImage(item, () => render())),
        );
      if (item.kind === "video")
        actions.append(
          button("Lấy khung hình", async () => {
            await captureFrame(
              item,
              card.querySelector("video")?.currentTime || 0,
            );
            await render();
            notice("Đã lưu khung hình vào Kho Kết quả");
          }),
        );
      if (item.blob)
        actions.append(
          button("Tải xuống", () => {
            const a = el("a");
            a.href = URL.createObjectURL(item.blob);
            a.download = item.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          }),
        );
      if (category === "prompts")
        actions.append(button("Sửa prompt", () => promptDialog(item)));
      actions.append(
        button("Xóa", async () => {
          if (item.blob) {
            const used = (await repo.list()).filter((p) =>
              p.graph.nodes.some((n) => n.data.assetId === item.id),
            );
            if (used.length) {
              notice(
                "Đang dùng trong: " +
                  used.map((p) => p.name).join(", ") +
                  ". Hãy bỏ nguồn khỏi dự án trước khi xóa.",
              );
              return;
            }
          }
          if (
            !confirm("Xóa “" + item.name + "” khỏi " + titles[category] + "?")
          )
            return;
          await remove(category, item.id);
          await render();
        }),
      );
      card.append(actions);
      cards.append(card);
    }
    if (!cards.childNodes.length)
      cards.append(
        el("p", "Chưa có mục nào trong " + titles[category] + ".", "intro"),
      );
  }
  function promptDialog(item) {
    const d = el("dialog"),
      form = el("form"),
      name = el("input"),
      text = el("textarea");
    name.required = true;
    name.placeholder = "Tên prompt";
    name.setAttribute("aria-label", "Tên prompt");
    name.maxLength = 100;
    name.value = item?.name || "";
    text.required = true;
    text.placeholder = "Nội dung prompt";
    text.setAttribute("aria-label", "Nội dung prompt");
    text.maxLength = 50000;
    text.value = item?.text || "";
    const save = el("button", "Lưu");
    save.type = "submit";
    form.append(
      el("h2", "Kho Prompt"),
      name,
      text,
      save,
      button("Hủy", () => d.close()),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await write("prompts", {
          id: item?.id || crypto.randomUUID(),
          name: name.value.trim(),
          text: text.value,
          createdAt: item?.createdAt || new Date().toISOString(),
        });
        d.close();
        await render();
      } catch (e) {
        notice(e.message);
      } finally {
        save.disabled = false;
      }
    };
    d.append(form);
    document.body.append(d);
    d.onclose = () => d.remove();
    d.showModal();
  }
  await render();
  return () => {
    alive = false;
    urls.forEach(URL.revokeObjectURL);
  };
}
export async function mountSettings(host) {
  host.replaceChildren(
    el("h1", "Kết nối AI"),
    el(
      "p",
      "Ghép MooZ Connect với máy chủ, hoặc sử dụng API được cấu hình riêng.",
      "intro",
    ),
  );
  const panel = el("section", undefined, "settings-panel"),
    status = el("p", "Đang kiểm tra máy chủ…"),
    code = el("textarea");
  code.readOnly = true;
  code.hidden = true;
  code.setAttribute("aria-label", "Mã ghép Chrome");
  const access = el("input");
  access.type = "password";
  access.placeholder = "Mã truy cập máy chủ (nếu có)";
  access.setAttribute("aria-label", "Mã truy cập máy chủ");
  const cards = el("div");
  panel.append(
    el("h2", "Máy chủ và Chrome"),
    status,
    access,
    button("Lưu mã truy cập phiên này", () => {
      sessionStorage.setItem("mooz-server-access", access.value);
      access.value = "";
      return refresh();
    }),
    button("Kiểm tra kết nối", refresh),
    button("Tạo mã ghép Chrome", async () => {
      const pair = await api("chrome/pair", {});
      code.value = pair.uri;
      code.hidden = false;
      notice(pair.note || "Mã ghép có hạn. Dán vào MooZ Connect.");
    }),
    code,
    button("Sao chép mã", async () => {
      if (!code.value) throw Error("Tạo mã ghép trước.");
      await navigator.clipboard.writeText(code.value);
      notice("Đã sao chép mã ghép");
    }),
    button("Ngắt kết nối", async () => {
      if (confirm("Ngắt phiên Chrome? Lượt đang gửi cần được đối chiếu.")) {
        await api("chrome/disconnect", {});
        code.value = "";
        code.hidden = true;
        await refresh();
      }
    }),
  );
  const link = el("a", "Tải MooZ Connect 1.9.2", "back");
  link.href = "/downloads/MooZ-Connect.zip";
  panel.append(
    link,
    el(
      "p",
      "Cài tiện ích bằng Load unpacked, dán mã ghép, mở tab AI và đăng nhập. Kết nối local chỉ dùng khi Chrome và máy chủ Node chạy cùng máy; máy chủ cloud cần relay WSS.",
      "intro",
    ),
    el("h2", "AI qua API"),
    cards,
  );
  const provider = el("select"),
    tab = el("select");
  provider.setAttribute("aria-label", "AI cần kiểm tra");
  tab.setAttribute("aria-label", "Tab cần kiểm tra");
  for (const p of providerList.filter(
    (p) => !["google", "openai"].includes(p.id),
  ))
    provider.add(new Option(p.name, p.id));
  async function refreshTabs() {
    tab.replaceChildren(new Option("Chọn tab…", ""));
    for (const t of await api("tabs?provider=" + provider.value)) {
      const o = new Option(t.title || t.url, t.id);
      o.dataset.url = t.url;
      tab.add(o);
    }
  }
  provider.onchange = () => void refreshTabs().catch((e) => notice(e.message));
  panel.append(
    el("h2", "Kiểm tra tab AI"),
    provider,
    tab,
    button("Cập nhật tab", refreshTabs),
    button("Kiểm tra và tiếp tục", async () => {
      if (!tab.value) throw Error("Chọn tab trước.");
      await api("chrome/resume", {
        provider: provider.value,
        tabId: Number(tab.value),
        chatURL: tab.selectedOptions[0]?.dataset.url,
      });
      notice("Tab đã sẵn sàng. Không tự gửi lại các lượt cũ.");
    }),
  );
  host.append(panel);
  async function refresh() {
    try {
      const s = await api("status");
      if (!host.isConnected) return;
      status.textContent = s.chrome.connected
        ? "Chrome đã ghép · " + (s.chrome.mode || "local")
        : "Chrome chưa ghép" +
          (s.chrome.remoteConfigured
            ? " · Relay đã cấu hình"
            : " · Chưa cấu hình relay từ xa");
      cards.replaceChildren();
      for (const p of s.providers)
        cards.append(
          el(
            "p",
            p.name +
              " · " +
              (p.ready ? "Có khóa trên máy chủ" : "Chưa cấu hình khóa"),
          ),
        );
      const sidebar = document.querySelector(".connection small");
      if (sidebar)
        sidebar.textContent = s.chrome.connected
          ? "Chrome đã ghép"
          : "Chưa ghép Chrome";
    } catch (e) {
      status.textContent = e.message;
    }
  }
  await refresh();
  return () => {
    code.value = "";
  };
}
const labels = {
  queued: "Chờ lượt",
  preparing: "Chuẩn bị",
  sent: "Đã gửi · chờ AI",
  receiving: "Nhận kết quả",
  success: "Hoàn tất",
  error: "Chưa hoàn tất",
  unknown: "Cần đối chiếu",
  stopped: "Đã dừng",
  review: "Đã thu hồi kết quả",
};
export async function mountBatch(host, kind) {
  let alive = true;
  host.replaceChildren(
    el("h1", kind === "image" ? "Tạo ảnh hàng loạt" : "Tạo video hàng loạt"),
    el(
      "p",
      "Mỗi tác vụ giữ riêng prompt, đầu vào và một AI/tab qua toàn bộ luồng.",
      "intro",
    ),
  );
  const form = el("form", undefined, "batch-form settings-panel"),
    prompts = el("textarea");
  prompts.placeholder = "Mỗi dòng là một tác vụ riêng…";
  prompts.setAttribute("aria-label", "Prompt hàng loạt");
  prompts.required = true;
  prompts.maxLength = 50000;
  const provider = el("select"),
    tabs = el("select"),
    ratio = el("select"),
    template = el("select"),
    source = el("select");
  provider.setAttribute("aria-label", "AI hàng loạt");
  tabs.setAttribute("aria-label", "Tab hàng loạt");
  source.setAttribute("aria-label", "Ảnh đầu vào");
  source.add(new Option("Không có ảnh đầu vào", ""));
  for (const a of (await list("inputs")).filter((a) => a.kind === "image"))
    source.add(new Option(a.name, a.id));
  template.add(new Option("Luồng một bước", ""));
  const templates = await list("templates");
  for (const t of templates) template.add(new Option(t.name, t.id));
  for (const p of providerList.filter((p) => p.types.includes(kind)))
    provider.add(new Option(p.name, p.id));
  for (const r of ["16:9", "9:16", "1:1"]) ratio.add(new Option(r, r));
  const duration = el("select");
  for (const d of [5, 10, 15, 30, 40]) duration.add(new Option(d + " giây", d));
  duration.hidden = kind !== "video";
  async function refresh() {
    tabs.replaceChildren(new Option("Chọn tab chạy tác vụ…", ""));
    if (["google", "openai"].includes(provider.value)) return;
    try {
      for (const t of await api("tabs?provider=" + provider.value)) {
        const o = new Option(t.title || t.url, t.id);
        o.dataset.url = t.url;
        tabs.add(o);
      }
    } catch (e) {
      notice(e.message);
    }
  }
  provider.onchange = refresh;
  const submit = el("button", "Xếp tác vụ vào hàng đợi");
  submit.type = "submit";
  form.append(
    el("h2", "Đầu vào & chạy"),
    prompts,
    source,
    template,
    provider,
    tabs,
    button("Cập nhật tab", refresh),
    ratio,
    duration,
    submit,
  );
  const history = el("section", undefined, "queue-list");
  host.append(form, el("h2", "Hàng đợi và lịch sử"), history);
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const lines = prompts.value
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      if (!lines.length || lines.length > 50)
        throw Error("Nhập từ 1 đến 50 dòng prompt.");
      if (!["google", "openai"].includes(provider.value) && !tabs.value)
        throw Error("Chọn tab đang kết nối trước khi xếp tác vụ.");
      const snapshot = template.value
        ? templates.find((t) => t.id === template.value)?.graph
        : null;
      for (const text of lines) {
        let graph = snapshot ? structuredClone(snapshot) : emptyGraph();
        if (!snapshot)
          graph.nodes.push({
            id: crypto.randomUUID(),
            type: kind === "image" ? "generateImage" : "generateVideo",
            x: 450,
            y: 100,
            data: {
              studioPrompt: text,
              size: ratio.value,
              duration: Number(duration.value),
            },
          });
        else {
          const generator = graph.nodes.find((n) =>
            n.type.startsWith("generate"),
          );
          if (!generator) throw Error("Mẫu chưa có bước AI.");
          generator.data.studioPrompt = text;
          for (const n of graph.nodes.filter((n) =>
            n.type.startsWith("generate"),
          ))
            delete n.data.assetId;
        }
        if (source.value) {
          const n = {
              id: crypto.randomUUID(),
              type: "imageInput",
              x: 40,
              y: 100,
              data: { assetId: source.value },
            },
            target = graph.nodes.find((n) => n.type.startsWith("generate"));
          if (target.type === "generateText")
            throw Error(
              "Mẫu có bước đầu là văn bản, chưa hỗ trợ ảnh trực tiếp.",
            );
          graph.nodes.push(n);
          graph.edges.push({
            id: crypto.randomUUID(),
            source: n.id,
            sourcePort: "image",
            target: target.id,
            targetPort: "reference",
          });
        }
        const job = await createJob({
          projectId: null,
          graph,
          provider: provider.value,
          tabId: tabs.value ? Number(tabs.value) : null,
          chatURL: tabs.selectedOptions[0]?.dataset.url || null,
          title: text.slice(0, 80),
          kind,
        });
        void startJob(job.id, () => void render()).catch((e) =>
          notice(e.message),
        );
      }
      prompts.value = "";
      await render();
    } catch (e) {
      notice(e.message);
    } finally {
      submit.disabled = false;
    }
  };
  async function render() {
    const jobs = (await list("jobs"))
      .filter((j) => j.kind === kind || !j.kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!alive || !history.isConnected) return;
    history.replaceChildren();
    for (const job of jobs) {
      const row = el("article", undefined, "queue-row");
      row.append(
        el("strong", job.title),
        el("span", labels[job.status] || job.status, "job-state " + job.status),
      );
      if (job.error) row.append(el("p", job.error));
      const actions = el("div", undefined, "project-actions");
      if (job.status === "queued")
        actions.append(
          button("Chạy", async () => {
            await startJob(job.id, () => void render());
            await render();
          }),
        );
      if (["queued", "preparing", "sent", "receiving"].includes(job.status))
        actions.append(
          button("Dừng", async () => {
            await stopJob(job.id);
            await render();
          }),
        );
      if (job.status === "unknown")
        actions.append(
          button("Kiểm tra kết quả", async () => {
            await inspectJob(job.id);
            await render();
          }),
        );
      if (!["preparing", "sent", "receiving"].includes(job.status))
        actions.append(
          button("Xóa lịch sử", async () => {
            if (
              confirm(
                "Xóa bản ghi tác vụ? Media trong Kho Kết quả vẫn được giữ.",
              )
            ) {
              await remove("jobs", job.id);
              await render();
            }
          }),
        );
      row.append(actions);
      history.append(row);
    }
    if (!jobs.length) history.append(el("p", "Chưa có tác vụ.", "intro"));
  }
  await refresh();
  await recoverJobs();
  await render();
  const timer = setInterval(() => void render(), 3000);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
