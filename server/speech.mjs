export function validateSpeech(input, env = process.env) {
  if (!env.MOOZ_OPENAI_KEY) throw Error('Chưa cấu hình OpenAI API để xử lý lời nói.');
  if (!['voiceover','transcribe'].includes(input.operation)) throw Error('Công cụ lời nói không hợp lệ.');
  if (input.operation === 'voiceover') {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096) throw Error('Lời đọc cần từ 1 đến 4096 ký tự.');
    const speed = Number(input.settings?.speed ?? 1);
    if (!Number.isFinite(speed) || speed < .25 || speed > 4) throw Error('Tốc độ giọng đọc cần 0,25–4.');
    if (input.settings?.voice && !['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'].includes(input.settings.voice)) throw Error('Giọng đọc không hợp lệ.');
  } else {
    if (typeof input.data !== 'string' || !/^data:(audio\/(mpeg|wav|mp4|ogg|webm)|video\/(mp4|webm|quicktime));base64,[a-zA-Z0-9+/=]+$/.test(input.data)) throw Error('Cần video/audio gốc cho nhận diện lời nói.');
    const bytes = Buffer.byteLength(input.data.slice(input.data.indexOf(',') + 1), 'base64');
    if (!bytes || bytes > 25*1024*1024) throw Error('Whisper chỉ nhận tệp tối đa 25 MB.');
  }
}
export async function speechAPI(input, { env = process.env, fetchImpl = fetch } = {}) {
  validateSpeech(input, env);
  const headers = { Authorization: 'Bearer ' + env.MOOZ_OPENAI_KEY };
  let url, body;
  if (input.operation === 'voiceover') {
    url = 'https://api.openai.com/v1/audio/speech'; headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ model: 'gpt-4o-mini-tts', input: input.text, voice: input.settings?.voice || 'coral', speed: Number(input.settings?.speed ?? 1), response_format: 'mp3' });
  } else {
    url = 'https://api.openai.com/v1/audio/transcriptions';
    const mime = input.data.slice(5, input.data.indexOf(';')), bytes = Buffer.from(input.data.slice(input.data.indexOf(',') + 1), 'base64');
    body = new FormData(); body.append('file', new Blob([bytes], { type: mime }), 'source.' + ({ 'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav','audio/ogg':'ogg','audio/webm':'webm' }[mime]));
    body.append('model', 'whisper-1'); body.append('response_format','srt');
  }
  const response = await fetchImpl(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw Error('OpenAI lời nói trả HTTP ' + response.status + '. Kiểm tra lượt đã gửi trước khi thử lại.');
  if (input.operation === 'transcribe') { const text = await response.text(); if (!text.trim() || text.length > 200000) throw Error('Phụ đề trả về rỗng hoặc quá lớn.'); return { kind: 'text', text }; }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 25*1024*1024) throw Error('Kết quả giọng đọc rỗng hoặc quá lớn.');
  return { kind: 'audio', url: 'data:audio/mpeg;base64,' + bytes.toString('base64') };
}
