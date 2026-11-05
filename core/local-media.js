import '../vendor/mooz/workflow-runtime.js';
import '../vendor/mooz/media-studio.js';
let engine;
export async function loadMediaEngine() {
  if (globalThis.FFmpegWASM) return globalThis.WorkflowStudio;
  engine ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/mooz/ffmpeg/ffmpeg.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.WorkflowStudio);
    script.onerror = () => { script.remove(); engine = null; reject(Error('Không tải được bộ xử lý FFmpeg local.')); };
    document.head.append(script);
  });
  return engine;
}
export async function processMedia(operation, { videos = [], audios = [], images = [], settings = {}, captions = '', lines = [] } = {}, signal, progress) {
  const studio = await loadMediaEngine(), urls = [];
  const wrap = asset => {
    if (!asset?.blob?.size) throw Error('Thiếu tệp media đầu vào.');
    const url = URL.createObjectURL(asset.blob); urls.push(url);
    return { ...asset, url };
  };
  try { return await studio.process(operation === 'finalOutput' || operation === 'assembleVideo' ? 'videoAssembly' : operation, { videos: videos.map(wrap), audios: audios.map(wrap), images: images.map(wrap), settings, captions, lines }, signal, progress); }
  finally { for (const url of urls) URL.revokeObjectURL(url); }
}
export const parseSrt = value => globalThis.WorkflowStudio.parseSrt(value);
