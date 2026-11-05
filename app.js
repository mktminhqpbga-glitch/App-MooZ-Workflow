import { mountStudio } from "./studio.js";
import { mountLibrary, mountSettings, mountBatch } from "./modules.js";
import { mountProjects, mountProject } from "./projects-ui.js";
const $ = (id) => document.getElementById(id);
const paths = {
  arrow: "M6 18 18 6M6 6h12v12",
  home: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  canvas: "M3 4h18v16H3zM8 4v16M8 15l4-4 4 4 3-3",
  images: "M6 3h15v15M3 6h15v15H3zM3 17l5-5 4 4 3-3 3 3M8 10h.01",
  videos: "M3 6h15v15H3zM6 3h15v15M9 10l5 3-5 3z",
  library: "M3 5h7l2 3h9v13H3z",
  settings: "M4 7h16M4 17h16M9 4v6M15 14v6",
  appearance:
    "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 1 1 0 0 1 1-2h2a5 5 0 0 0 4-5 9 9 0 0 0-9-7zM7 10h.01M10 6h.01M15 6h.01M18 10h.01",
};
const icon = (key) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key] || paths.home}"/></svg>`;
const modules = [
  {
    id: "canvas",
    title: "Canvas",
    description: "Một không gian mở để kết nối ý tưởng, hình ảnh và video.",
    foot: "Không gian sáng tạo",
    empty: "Không gian canvas",
    detail: "Canvas sẽ được xây dựng ở bước tiếp theo.",
  },
  {
    id: "images",
    title: "Tạo ảnh hàng loạt",
    description: "Biến nhiều ý tưởng thành bộ ảnh trong cùng một lượt.",
    foot: "Sáng tạo hình ảnh",
    empty: "Chưa có tác vụ tạo ảnh",
    detail: "Bộ tạo ảnh hàng loạt sẽ được kết nối ở bước tiếp theo.",
  },
  {
    id: "videos",
    title: "Tạo video hàng loạt",
    description: "Tổ chức nhiều cảnh quay, theo dõi từng video tại một nơi.",
    foot: "Sáng tạo video",
    empty: "Chưa có tác vụ tạo video",
    detail: "Bộ tạo video hàng loạt sẽ được kết nối ở bước tiếp theo.",
  },
  {
    id: "library",
    title: "Kho",
    description: "Nơi tập hợp hình ảnh, video và tài nguyên của bạn.",
    foot: "Tất cả tài sản",
    empty: "Kho chưa có tài sản",
    detail: "Phần tải lên và quản lý tài sản sẽ được xây dựng riêng.",
  },
  {
    id: "settings",
    title: "Cài đặt",
    description:
      "Quản lý kết nối AI và chọn cách làm việc với dịch vụ của bạn.",
    foot: "Kết nối AI",
    empty: "Chưa có kết nối AI",
    detail:
      "Phần ghép Chrome, chọn AI và thiết lập API sẽ được làm riêng. Hiện chưa có kết nối đang hoạt động.",
  },
  {
    id: "appearance",
    title: "Giao diện",
    description: "Chọn màu sắc và độ gọn cho không gian làm việc của bạn.",
    foot: "Theo cách của bạn",
  },
];
const defaults = {
  theme: "dark",
  accent: "#c3d2bb",
  density: "comfortable",
  motion: true,
};
let prefs = { ...defaults };
try {
  const stored = JSON.parse(
    localStorage.getItem("mooz-cvn-appearance") || "{}",
  );
  if (["dark", "light"].includes(stored.theme)) prefs.theme = stored.theme;
  if (/^#[a-f0-9]{6}$/i.test(stored.accent || "")) prefs.accent = stored.accent;
  if (["comfortable", "compact"].includes(stored.density))
    prefs.density = stored.density;
  if (typeof stored.motion === "boolean") prefs.motion = stored.motion;
} catch {}
const palettes = {
  dark: {
    bg: "#171819",
    panel: "#202122",
    raised: "#262729",
    hover: "#2b2d2e",
    line: "#343637",
    ink: "#eeefec",
    muted: "#969b99",
  },
  light: {
    bg: "#f6f7f4",
    panel: "#ffffff",
    raised: "#eef0eb",
    hover: "#e5e9e1",
    line: "#dce0d8",
    ink: "#232921",
    muted: "#70786e",
  },
};
function apply() {
  for (const [key, value] of Object.entries(palettes[prefs.theme]))
    document.documentElement.style.setProperty("--" + key, value);
  document.documentElement.style.colorScheme = prefs.theme;
  document.documentElement.style.setProperty("--accent", prefs.accent);
  document.documentElement.style.setProperty("--accent-ink", "#20291d");
  document.body.classList.toggle("compact", prefs.density === "compact");
  document.body.classList.toggle("no-motion", !prefs.motion);
  document.documentElement.dataset.theme = prefs.theme;
}
let timer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").hidden = true), 2600);
}
function save() {
  apply();
  try {
    localStorage.setItem("mooz-cvn-appearance", JSON.stringify(prefs));
    toast("Đã lưu giao diện của bạn");
  } catch {
    toast("Trình duyệt chưa cho phép lưu giao diện");
  }
}
function home() {
  return `<section class="hero"><div><span class="eyebrow">MOOZ CVN · CREATIVE WORKSPACE</span><h1>Bạn muốn tạo gì hôm nay?</h1><p class="intro">Từ một ý tưởng đến cả bộ nội dung.<br>Chọn không gian để bắt đầu, mọi thứ đều ở đây.</p></div><span class="hero-note"><i></i> Không gian của bạn</span></section><div class="section-title"><h2>Công cụ sáng tạo</h2><span>6 không gian · Một điểm bắt đầu</span></div><section class="modules" aria-label="Các chức năng chính">${modules.map((m, i) => `<a class="module" href="#${m.id}"><div class="module-top"><span class="module-icon">${icon(m.id)}</span><span class="module-arrow">${icon("arrow")}</span></div><h3>${m.title}</h3><p>${m.description}</p><div class="module-bottom"><span>${m.foot}</span><span>${String(i + 1).padStart(2, "0")}</span></div></a>`).join("")}</section><section class="recent"><div class="section-title"><h2>Không gian gần đây</h2><span>Dự án của bạn</span></div><div class="empty"><span class="empty-icon">${icon("library")}</span><div><p>Một khởi đầu mới.</p><small>Các dự án sẽ xuất hiện ở đây khi bạn bắt đầu sáng tạo.</small></div><a href="#canvas">Khám phá Canvas ${icon("arrow")}</a></div></section>`;
}
function appearance() {
  return `<a class="back" href="#home">← Về tổng quan</a><div><span class="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Giao diện</h1><p class="intro">Điều chỉnh một chút, làm việc thoải mái hơn.<br>Thay đổi áp dụng ngay và được lưu trên trình duyệt này.</p></div><section class="settings-panel" aria-label="Tùy chỉnh giao diện"><div class="setting-row"><div><strong>Chế độ hiển thị</strong><p>Nền sáng hoặc tối cho không gian làm việc.</p></div><div class="segmented" aria-label="Chế độ hiển thị">${[
    ["dark", "Tối"],
    ["light", "Sáng"],
  ]
    .map(
      ([v, l]) =>
        `<button data-theme="${v}" aria-pressed="${prefs.theme === v}">${l}</button>`,
    )
    .join(
      "",
    )}</div></div><div class="setting-row"><div><strong>Màu nhấn</strong><p>Một điểm nhấn cho các công cụ và điều hướng.</p></div><div class="swatches">${[
    ["#c3d2bb", "Xanh lá"],
    ["#bfd0e5", "Xanh dương"],
    ["#cfc2e6", "Tím"],
    ["#e1c5aa", "Cam nhạt"],
  ]
    .map(
      ([v, l]) =>
        `<button class="swatch" data-accent="${v}" aria-label="${l}" aria-pressed="${prefs.accent === v}" style="background:${v}"></button>`,
    )
    .join(
      "",
    )}</div></div><div class="setting-row"><div><strong>Mật độ hiển thị</strong><p>Nhiều khoảng thở hoặc gọn hơn trên cùng màn hình.</p></div><div class="segmented">${[
    ["comfortable", "Thoải mái"],
    ["compact", "Gọn"],
  ]
    .map(
      ([v, l]) =>
        `<button data-density="${v}" aria-pressed="${prefs.density === v}">${l}</button>`,
    )
    .join(
      "",
    )}</div></div><div class="setting-row"><div><strong>Chuyển động giao diện</strong><p>Hiệu ứng nhẹ khi di chuột và mở điều hướng.</p></div><button id="motion" aria-pressed="${prefs.motion}" class="segmented">${prefs.motion ? "Đang bật" : "Đã tắt"}</button></div></section><button class="reset" id="reset">↺ Khôi phục giao diện mặc định</button>`;
}
let cleanup = () => {},
  routeRevision = 0;
function route() {
  const revision = ++routeRevision;
  cleanup();
  cleanup = () => {};
  const canvasId = location.hash.startsWith("#canvas/")
    ? location.hash.slice(8)
    : null;
  const projectId = location.hash.startsWith("#project/")
    ? location.hash.slice(9)
    : null;
  let key = canvasId
    ? "canvas"
    : projectId
      ? "project"
      : location.hash.slice(1) || "home";
  if (key !== "project" && key !== "home" && !modules.some((m) => m.id === key))
    key = "home";
  const m = modules.find((m) => m.id === key);
  document.title =
    (key === "project" ? "Dự án" : m?.title || "Trung tâm điều khiển") +
    " · MooZ CVN";
  $("crumb").textContent =
    key === "project" ? "Dự án" : m?.title || "Tổng quan";
  $("nav").innerHTML = [{ id: "home", title: "Tổng quan" }, ...modules]
    .map(
      (m, i) =>
        (i === 5 ? '<div class="nav-divider"></div>' : "") +
        `<a class="nav-link ${key === m.id ? "active" : ""}" href="#${m.id}" aria-label="${m.title}" ${key === m.id ? 'aria-current="page"' : ""}>${icon(m.id)}<span>${m.title}</span></a>`,
    )
    .join("");
  $("main").innerHTML =
    key === "home"
      ? home()
      : key === "project"
        ? '<a class="back" href="#home">← Về tổng quan</a><span class="eyebrow">MOOZ CVN · DỰ ÁN</span><h1>Dữ liệu dự án</h1><section class="settings-panel" id="projectDetail"></section>'
        : key === "appearance"
          ? appearance()
          : `<a class="back" href="#home">← Về tổng quan</a><span class="eyebrow">MOOZ CVN</span><h1>${m.title}</h1><p class="intro">${m.description}</p><section class="placeholder">${icon(m.id)}<h2>${m.empty}</h2><p>${m.detail}</p><span class="badge">Chưa triển khai trong bước này</span></section>`;
  closeMobile();
  if (["canvas", "library", "settings", "images", "videos"].includes(key)) {
    const slot = document.createElement("section");
    $("main").replaceChildren(slot);
    const task =
      key === "canvas"
        ? mountStudio(slot, canvasId)
        : key === "library"
          ? mountLibrary(slot)
          : key === "settings"
            ? mountSettings(slot)
            : mountBatch(slot, key === "images" ? "image" : "video");
    void task
      .then((fn) => {
        if (revision === routeRevision) cleanup = fn || (() => {});
        else fn?.();
      })
      .catch((e) => {
        if (slot.isConnected) slot.textContent = e.message;
      });
  }
  if (key === "home") mountProjects(document.querySelector(".recent"));
  if (key === "project") void mountProject($("projectDetail"), projectId);
  if (key === "appearance") {
    document.querySelectorAll("[data-theme]").forEach(
      (b) =>
        (b.onclick = () => {
          prefs.theme = b.dataset.theme;
          save();
          route();
        }),
    );
    document.querySelectorAll("[data-accent]").forEach(
      (b) =>
        (b.onclick = () => {
          prefs.accent = b.dataset.accent;
          save();
          route();
        }),
    );
    document.querySelectorAll("[data-density]").forEach(
      (b) =>
        (b.onclick = () => {
          prefs.density = b.dataset.density;
          save();
          route();
        }),
    );
    $("motion").onclick = () => {
      prefs.motion = !prefs.motion;
      save();
      route();
    };
    $("reset").onclick = () => {
      prefs = { ...defaults };
      save();
      route();
    };
  }
}
function closeMobile() {
  $("nav").closest("aside").classList.remove("open");
  $("mobileBackdrop").hidden = true;
  $("mobileMenu").setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".nav-link")) closeMobile();
  const b = e.target.closest("[data-route]");
  if (b) location.hash = b.dataset.route;
});
$("appearanceIcon").innerHTML = icon("appearance");
$("mobileMenu").onclick = () => {
  const open = document.querySelector(".sidebar").classList.toggle("open");
  $("mobileBackdrop").hidden = !open;
  $("mobileMenu").setAttribute("aria-expanded", String(open));
};
$("mobileBackdrop").onclick = closeMobile;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMobile();
});
window.addEventListener("hashchange", route);
apply();
route();
