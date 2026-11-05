import { el, notice } from './client-api.js';
import { readAsset } from './core/storage.js';

// Store plain text and stable node references, never editable HTML.
export function createVideoPrompt({ value = '', getReferences, onChange }) {
  const field = el('div', undefined, 'video-prompt-editor');
  field.contentEditable = 'true';
  field.setAttribute('role', 'textbox');
  field.setAttribute('aria-multiline', 'true');
  field.dataset.placeholder = 'Mô tả cảnh quay, chuyển động… Kéo ảnh tham chiếu vào đúng vị trí trong câu.';
  let lastValue = value;
  const serialize = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.dataset?.referenceId) return `@{asset:${node.dataset.referenceId}}`;
    if (node.nodeName === 'BR') return '\n';
    return [...node.childNodes].map(serialize).join('') + (node !== field && ['DIV', 'P'].includes(node.nodeName) ? '\n' : '');
  };
  const token = (id) => {
    const reference = getReferences().find(reference => reference.id === id),
      chip = el('span', undefined, 'video-reference-token');
    chip.dataset.referenceId = id;
    chip.contentEditable = 'false';
    chip.title = reference?.name || 'Tham chiếu đã bị gỡ khỏi node';
    chip.classList.toggle('missing-reference', !reference);
    chip.append(el('span', reference?.label || 'Đã gỡ tham chiếu'));
    if (reference?.assetId) void (async () => {
      const asset = await readAsset(reference.assetId);
      if (asset?.kind !== 'image') return;
      const url = URL.createObjectURL(asset.blob), img = el('img');
      img.alt = '';
      img.draggable = false;
      img.onload = img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
      chip.prepend(img);
    })().catch(() => {});
    return chip;
  };
  const hydrate = (text) => {
    field.replaceChildren();
    const expression = /@\{asset:([a-zA-Z0-9_-]{1,100})\}/g;
    let offset = 0;
    for (const match of text.matchAll(expression)) {
      field.append(document.createTextNode(text.slice(offset, match.index)), token(match[1]));
      offset = match.index + match[0].length;
    }
    field.append(document.createTextNode(text.slice(offset)));
  };
  const changed = () => {
    const text = serialize(field);
    if (text.length > 50000) {
      hydrate(lastValue);
      notice('Prompt tối đa 50.000 ký tự.');
      return;
    }
    lastValue = text;
    onChange(text);
  };
  Object.defineProperty(field, 'value', {
    get: () => serialize(field),
    set: (text) => { lastValue = String(text); hydrate(lastValue); },
  });
  field.value = value;
  field.addEventListener('input', changed);
  const insertionRange = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && field.contains(selection.anchorNode) && field.contains(selection.focusNode)) return selection.getRangeAt(0);
    const range = document.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    return range;
  };
  const insert = (node) => {
    const range = insertionRange();
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    field.focus({ preventScroll: true });
    changed();
  };
  field.insertReference = (id) => {
    if (!getReferences().some(reference => reference.id === id)) throw Error('Nguồn này chưa được nối làm dữ liệu tham chiếu.');
    if (field.value.length + id.length + 9 > 50000) throw Error('Prompt tối đa 50.000 ký tự.');
    insert(token(id));
  };
  field.addEventListener('paste', event => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (field.value.length + text.length > 50000) { notice('Prompt tối đa 50.000 ký tự.'); return; }
    insert(document.createTextNode(text));
  });
  field.addEventListener('dragover', event => {
    if ([...event.dataTransfer.types].includes('application/x-mooz-reference')) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      field.classList.add('reference-drop-target');
    }
  });
  field.addEventListener('dragleave', () => field.classList.remove('reference-drop-target'));
  field.addEventListener('drop', event => {
    const id = event.dataTransfer.getData('application/x-mooz-reference');
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    field.classList.remove('reference-drop-target');
    let range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!range && document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (position) { range = document.createRange(); range.setStart(position.offsetNode, position.offset); range.collapse(true); }
    }
    if (range && field.contains(range.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    try { field.insertReference(id); } catch (error) { notice(error.message); }
  });
  return field;
}
