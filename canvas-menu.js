import { el, button } from './client-api.js';

export function createCanvasMenu(signal) {
  const menu = el('div', undefined, 'canvas-context-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Thao tác Canvas');
  menu.hidden = true;
  document.body.append(menu);
  const submenu = el('div', undefined, 'canvas-context-menu canvas-context-submenu');
  submenu.setAttribute('role', 'menu'); submenu.setAttribute('aria-label', 'Loại node'); submenu.hidden = true;
  document.body.append(submenu);
  let parentControl = null;
  const closeSubmenu = () => { submenu.hidden = true; parentControl?.setAttribute('aria-expanded', 'false'); parentControl = null; };
  let point = { x: 0, y: 0 };
  const close = () => { menu.hidden = true; closeSubmenu(); };
  function openSubmenu(item, control, focus = false) {
    closeSubmenu(); parentControl = control; control.setAttribute('aria-expanded', 'true');
    submenu.replaceChildren(); submenu.hidden = false;
    for (const child of item.children) {
      const choice = button(child.label, async () => { close(); await child.action?.(); });
      choice.setAttribute('role', 'menuitem'); choice.disabled = Boolean(child.disabled); submenu.append(choice);
    }
    const rect = control.getBoundingClientRect(), root = menu.getBoundingClientRect();
    submenu.style.left = Math.max(8, root.right + submenu.offsetWidth < innerWidth - 8 ? root.right - 1 : root.left - submenu.offsetWidth + 1) + 'px';
    submenu.style.top = Math.max(8, Math.min(rect.top, innerHeight - submenu.offsetHeight - 8)) + 'px';
    if (focus) submenu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  }
  const show = (items, x = point.x, y = point.y) => {
    closeSubmenu();
    point = { x, y };
    menu.replaceChildren();
    menu.hidden = false;
    for (const item of items) {
      if (item.element) { menu.append(item.element); continue; }
      if (item.separator) { menu.append(el('hr')); continue; }
      const control = button('', async () => {
        if (item.children) {
          openSubmenu(item, control, true);
          return;
        }
        if (!item.keepOpen) close();
        await item.action?.();
      });
      control.setAttribute('role', 'menuitem');
      if (item.children) {
        control.setAttribute('aria-haspopup', 'menu'); control.setAttribute('aria-expanded', 'false');
        control.onpointerenter = event => { if (event.pointerType !== 'touch' && !control.disabled) openSubmenu(item, control); };
        control.onkeydown = event => { if (event.key === 'ArrowRight') { event.preventDefault(); openSubmenu(item, control, true); } };
      } else control.onpointerenter = closeSubmenu;
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
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !submenu.contains(event.target)) close(); }, { capture: true, signal });
  document.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      if (!submenu.hidden) { const parent = parentControl; closeSubmenu(); parent?.focus({ preventScroll: true }); }
      else if (event.key === 'Escape') close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const controls = [...(submenu.contains(document.activeElement) ? submenu : menu).querySelectorAll('button:not([disabled])')];
    const current = controls.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    controls[index]?.focus();
  }, { signal });
  signal.addEventListener('abort', () => { menu.remove(); submenu.remove(); }, { once: true });
  return { show, close };
}
