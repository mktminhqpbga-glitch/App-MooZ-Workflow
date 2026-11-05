const paths = {
  video: "M5 3h10v18H5zM15 9l6-4v14l-6-4zM8 7h4M8 17h4",
  sparkles: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3zM20 2v4M18 4h4",
  motion: "M3 9h10v9H3zM13 12l5-3v9l-5-3M5 5h13M15 2l3 3-3 3",
  model: "M12 8c-8-8-13 4-5 7 2 7 13 4 10-3 8-8-4-13-7-5-7 2-4 13 3 10M8 8l8 8M16 8l-8 8",
  frame: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  chevronUp: "m6 15 6-6 6 6",
  chevronDown: "m6 9 6 6 6-6",
  image: "M3 3h18v18H3zM3 17l5-6 5 5 3-4 5 6M15 7h.01",
  upload: "M12 16V3M7 8l5-5 5 5M3 15v6h18v-6",
  reference: "M4 4h16v12h-7l-4 5v-5H4zM8 8h8M8 12h5",
  pointer: "m5 3 14 10-7 1-3 7z",
  hand: "M8 12V6a2 2 0 0 1 4 0v6M12 10V4a2 2 0 0 1 4 0v8M16 9a2 2 0 0 1 4 0v7c0 5-12 7-14 1l-3-5a2 2 0 0 1 3-2l2 3",
  materials: "m5 3 4 4-4 4-4-4zM16 4h5v5h-5zM3 16h5v5H3zM17 14v8M13 18h8",
  smile:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M8 9h.01M16 9h.01M7 14c2 4 8 4 10 0",
  tools: "M3 8h18v13H3zM7 8V4a2 2 0 0 1 4 0v8M13 8V4a2 2 0 0 1 4 0v8",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v6l4 2",
  keyboard:
    "M3 5h18v14H3zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8",
  help: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01",
  edit: "m4 16 12-12 4 4L8 20H4zM14 6l4 4M4 4v4M2 6h4",
  grid: "M8 3v18M16 3v18M3 8h18M3 16h18",
  layers: "m12 2 10 6-10 6L2 8zM2 12l10 6 10-6M2 16l10 6 10-6",
  panorama: "M3 6c5-2 13-2 18 0v13c-5-2-13-2-18 0zM8 5v13",
  rotate: "M4 9V3M4 3h6M4 3l4 4M8 7a8 8 0 1 1-2 9",
  draw: "M3 17C18-2 23 0 10 14s-1 6 6 0 5 4 5 4",
  download: "M12 3v12M7 10l5 5 5-5M3 17v4h18v-4",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  angles: "M12 2a10 10 0 0 0 0 20M4 12h16M15 7l5 5-5 5M12 2c-5 5-5 15 0 20",
  camera: "M3 7h5l2-3h4l2 3h5v14H3zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  pin: "M12 22 5 12a8 8 0 1 1 14 0zM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  sliders: "M3 7h18M3 17h18M8 3v8M16 13v8",
  style: "m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10",
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(s.namespaceURI, "path");
  p.setAttribute("d", paths[name] || paths.help);
  s.append(p);
  return s;
}
