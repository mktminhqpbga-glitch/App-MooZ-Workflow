// Pure preparation rules. No request, storage mutation or AI dispatch occurs here.
export const limits = Object.freeze({ imageBytes: 8 * 1024 * 1024, snapshotBytes: 32 * 1024 * 1024, imagesPerJob: 8, prompts: 50, promptChars: 20000, jobs: 200 });
export function splitPrompts(input, mode = 'blocks') {
  const text = String(input || '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw Error('Nhập ít nhất một prompt.');
  let parts;
  if (mode === 'blocks') {
    parts = []; let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '[') { if (!depth) start = i + 1; depth++; }
      else if (text[i] === ']') { if (!depth) throw Error('Dấu ] không có dấu [ mở.'); if (!--depth) parts.push(text.slice(start, i)); }
      else if (!depth && !/\s/.test(text[i])) throw Error('Đặt từng prompt trong [ ... ], hoặc chọn chế độ mỗi dòng/toàn văn.');
    }
    if (depth) throw Error('Khối prompt còn thiếu dấu ].');
  } else if (mode === 'lines') parts = text.split('\n');
  else if (mode === 'paragraphs') parts = text.split(/\n\s*\n/);
  else if (mode === 'whole') parts = [text];
  else throw Error('Chế độ tách prompt không hợp lệ.');
  parts = parts.map(value => value.trim()).filter(Boolean);
  if (!parts.length || parts.length > limits.prompts) throw Error('Mỗi đợt cần từ 1 đến 50 prompt.');
  if (parts.some(value => value.length > limits.promptChars)) throw Error('Mỗi prompt tối đa 20.000 ký tự.');
  return parts;
}
export function tagName(name) {
  return String(name || 'anh').replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'anh';
}
export function uniqueTags(assets) {
  const used = new Set(), result = new Map();
  for (const asset of assets) {
    const base = asset.batchTag || tagName(asset.name); let tag = base, suffix = 2;
    while (used.has(tag)) { const tail = '-' + suffix++; tag = base.slice(0, 48 - tail.length) + tail; }
    used.add(tag); result.set(asset.id, tag);
  }
  return result;
}
export function mentions(text) { return [...new Set([...String(text).matchAll(/(^|[^\w@])@([a-zA-Z0-9_-]+)/g)].map(match => match[2].toLowerCase()))]; }
export function validateImage(asset) {
  if (!asset?.id || !asset.blob?.size || !/^image\/(png|jpeg|webp)$/.test(asset.blob.type) || asset.blob.size > limits.imageBytes)
    throw Error('Ảnh tham chiếu cần PNG/JPG/WebP, tối đa 8 MB mỗi ảnh.');
  return asset;
}
export function prepareBatch({ prompts, assets, sourceId = '', characterIds = [], copies = 1, existingJobs = [] }) {
  if (!Number.isInteger(copies) || copies < 1 || copies > 10) throw Error('Số bản sao cần từ 1 đến 10.');
  if (!Array.isArray(prompts) || !prompts.length || prompts.length > limits.prompts || prompts.some(p => typeof p !== 'string' || !p.trim() || p.length > limits.promptChars)) throw Error('Prompt không hợp lệ: tối đa 50 prompt, mỗi prompt 20.000 ký tự.');
  if (existingJobs.length + prompts.length * copies > limits.jobs) throw Error('Hàng đợi tối đa 200 job. Dọn lịch sử hoàn tất trước khi thêm.');
  const tags = uniqueTags(assets), byTag = new Map(assets.map(asset => [tags.get(asset.id), asset])), frozen = new Map();
  for (const asset of assets.filter(asset=>asset.batchTag)) frozen.set(asset.id,asset.blob?.size||0);
  for (const job of existingJobs) for (const [id, asset] of Object.entries(job.inputAssets || {})) if (asset.kind === 'image') frozen.set(id, asset.blob?.size || 0);
  const plans = prompts.map(text => {
    const refs = new Map();
    if (sourceId) { const asset = assets.find(asset => asset.id === sourceId); validateImage(asset); refs.set(asset.id, asset); }
    for (const id of characterIds) { const asset = assets.find(asset => asset.id === id); validateImage(asset); refs.set(asset.id, asset); }
    for (const tag of mentions(text)) {
      const asset = byTag.get(tag); if (!asset) throw Error('Không tìm thấy ảnh @' + tag + '. Chưa xếp bất kỳ job nào.');
      validateImage(asset); refs.set(asset.id, asset);
    }
    if (refs.size > limits.imagesPerJob) throw Error('Mỗi job tối đa 8 ảnh tham chiếu.');
    for (const asset of refs.values()) frozen.set(asset.id, asset.blob.size);
    const prompt = text.replace(/(^|[^\w@])@([a-zA-Z0-9_-]+)/g, (all, prefix, tag) => prefix + '@{asset:' + byTag.get(tag.toLowerCase()).id + '}');
    return { prompt, originalPrompt: text, references: [...refs.values()].map(asset => ({ id: asset.id, name: asset.name, tag: tags.get(asset.id), role: characterIds.includes(asset.id) ? 'character' : asset.id === sourceId ? 'product' : 'reference' })) };
  });
  if ([...frozen.values()].reduce((sum, size) => sum + size, 0) > limits.snapshotBytes) throw Error('Ảnh snapshot trong hàng đợi vượt tổng 32 MB.');
  return plans.flatMap(plan => Array.from({ length: copies }, (_, copy) => ({ ...plan, copy: copy + 1, copies })));
}
export function parseScenes(raw, count) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw Error('Số cảnh cần từ 1 đến 12.');
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data; try { data = JSON.parse(text); } catch { throw Error('Kịch bản chưa phải JSON hợp lệ. Câu trả lời thô đã được giữ để sửa.'); }
  const scenes = Array.isArray(data) ? data : data.scenes;
  if (!Array.isArray(scenes) || scenes.length !== count) throw Error(`Kịch bản cần đúng ${count} cảnh; chưa gửi bước tạo ảnh/video.`);
  return scenes.map((scene, index) => {
    if (!scene || (scene.index !== undefined && scene.index !== index + 1) || ['title', 'voiceover', 'imagePrompt', 'videoPrompt'].some(key => typeof scene[key] !== 'string') || !scene.title.trim() || !scene.videoPrompt.trim() || !scene.imagePrompt.trim()) throw Error('Cảnh ' + (index + 1) + ' thiếu title/voiceover/imagePrompt/videoPrompt hoặc sai thứ tự.');
    if (scene.duration != null && (!Number.isFinite(scene.duration) || scene.duration <= 0 || scene.duration > 120)) throw Error('Thời lượng trong kịch bản không hợp lệ.');
    return { index: index + 1, title: scene.title, voiceover: scene.voiceover, imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt, ...(scene.duration == null ? {} : { duration: scene.duration }) };
  });
}
