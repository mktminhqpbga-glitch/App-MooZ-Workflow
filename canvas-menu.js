import { el, button } from './client-api.js';

export function createCanvasMenu(signal) {
  const menu = el('div', undefined, 'canvas-context-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Thao tác Canvas');
  menu.hidden = true;
  document.body.append(menu);
  let point = { x: 0, y: 0 };
  const close = () => { menu.hidden = true; };
  const show = (items, x = point.x, y = point.y) => {
    point = { x, y };
    menu.replaceChildren();
    menu.hidden = false;
    for (const item of items) {
      if (item.element) { menu.append(item.element); continue; }
      if (item.separator) { menu.append(el('hr')); continue; }
      const control = button('', async () => {
        if (item.children) {
          show([{ label: '← Quay lại', action: () => show(items, x, y), keepOpen: true }, ...item.children], x, y);
          return;
        }
        if (!item.keepOpen) close();
        await item.action?.();
      });
      control.setAttribute('role', 'menuitem');
      control.append(el('span', item.label));
      if (item.shortcut || item.children) control.append(el('span', item.shortcut || '›', 'context-menu-shortcut'));
      control.disabled = Boolean(item.disabled);
      if (item.title) control.title = item.title;
      if (item.danger) control.classList.add('context-menu-danger');
      menu.append(control);
    }
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const controls = [...menu.querySelectorAll('button:not([disabled])')];
    const current = controls.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    controls[index]?.focus();
  }, { signal });
  signal.addEventListener('abort', () => menu.remove(), { once: true });
  return { show, close };
}
