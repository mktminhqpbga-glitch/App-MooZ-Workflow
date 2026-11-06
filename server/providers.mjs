import {assertGenerationSettings} from '../core/provider-capabilities.js';
import {falTools,remotePlan,generateRemoteMedia} from './remote-media.mjs';
export function validateAPIInput(input, env = process.env) {
  if(input.operation && (input.provider!=='fal'||!Object.hasOwn(falTools,input.operation)))throw Error('Chưa có adapter chuyên dụng cho công cụ và nhà cung cấp này.');
  const provider = apiProviders[input.provider];
  if (!provider || !env[provider.key]) throw Error('Chưa cấu hình khóa API trên máy chủ.');
  if(input.provider==='fal'||input.provider==='google'&&input.mediaType==='video'){assertGenerationSettings(input);remotePlan(input,env);return;}
  if (!provider.types.includes(input.mediaType)) throw Error('API này chưa hỗ trợ đầu ra đã chọn. Dùng tab AI cho video.');
  if(input.provider==="openai"&&input.mediaType==="image"&&!/^gpt-image-/.test(env.MOOZ_OPENAI_IMAGE_MODEL||"gpt-image-1"))throw Error("Adapter OpenAI ảnh này cần model gpt-image, chưa dùng cấu hình DALL-E với thông số này.");
  assertGenerationSettings(input);
  const refs = input.referenceImages || [];
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 50000 || !Array.isArray(refs) || refs.length > 8 || refs.some(ref => typeof ref !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(ref))) throw Error('Prompt hoặc ảnh tham chiếu không hợp lệ.');
  const sizes = refs.map(ref => Buffer.byteLength(ref.slice(ref.indexOf(',')+1),'base64'));
  if (sizes.some(size => size > 8*1024*1024) || sizes.reduce((sum,size)=>sum+size,0)>32*1024*1024) throw Error('Ảnh tham chiếu vượt 8 MB/ảnh hoặc tổng 32 MB.');
  if (input.provider === 'openai' && input.mediaType === 'image' && refs.length && !/^gpt-image-/.test(env.MOOZ_OPENAI_IMAGE_MODEL || 'gpt-image-1')) throw Error('Model OpenAI đã cấu hình chưa có adapter chỉnh ảnh tham chiếu.');
}
export const apiProviders = {
  openai: {
    name: "OpenAI API",
    types: ["text", "image"],
    key: "MOOZ_OPENAI_KEY",
  },
  fal: { name:"fal API",types:["image","video"],key:"MOOZ_FAL_KEY" },
  google: {
    name: "Google Gemini / Veo API",
    types: ["text", "image", "video"],
    key: "MOOZ_GOOGLE_KEY",
  },
};
export async function generateAPI(
  input,
  { env = process.env, fetchImpl = fetch, signal, checkpoint } = {},
) {
  validateAPIInput(input, env);
  if(input.provider==='fal'||input.provider==='google'&&input.mediaType==='video')return generateRemoteMedia(input,{env,fetchImpl,signal,checkpoint});
  const p = apiProviders[input.provider], key = env[p.key], prompt = input.prompt, refs = input.referenceImages || [];
  const request = async (url, body, headers) => {
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: signal || AbortSignal.timeout(240000),
      headers: { ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    if (!res.ok) {
      const error = Error('API trả HTTP ' + res.status + '. Kiểm tra lượt đã gửi trước khi chạy lại.');
      if (res.status === 429) { const header=res.headers?.get('retry-after'), seconds=Number(header);error.code='RATE_LIMITED';error.retryAfterMs=Math.min(86400000,Math.max(1000,Number.isFinite(seconds)&&header!==null?seconds*1000:Date.parse(header)-Date.now()||60000)); }
      throw error;
    }
    const text = await res.text();
    if (text.length > 50 * 1024 * 1024) throw Error("Kết quả API quá lớn.");
    return JSON.parse(text);
  };
  if (input.provider === "openai") {
    if (input.mediaType === "image") {
      const size = input.size === '2:3' ? '1024x1536' : input.size === '3:2' ? '1536x1024' : '1024x1024';
      if (refs.length) {
        const form = new FormData();
        form.append('model',env.MOOZ_OPENAI_IMAGE_MODEL || 'gpt-image-1'); form.append('prompt',prompt); form.append('size',size); form.append('n','1');form.append('background',input.background||'auto'); form.append('quality',['low','medium','high'].includes(input.quality)?input.quality:'medium');
        for (const [index,ref] of refs.entries()) { const mime=ref.slice(5,ref.indexOf(';')),bytes=Buffer.from(ref.slice(ref.indexOf(',')+1),'base64');form.append('image[]',new Blob([bytes],{type:mime}),'reference-'+index+'.'+(mime==='image/jpeg'?'jpg':mime.split('/')[1])); }
        const r = await request('https://api.openai.com/v1/images/edits',form,{Authorization:'Bearer '+key});
        if (!r.data?.[0]?.b64_json) throw Error('API chưa trả dữ liệu ảnh.');
        return {kind:'image',url:'data:image/png;base64,'+r.data[0].b64_json};
      }
      const r = await request(
        "https://api.openai.com/v1/images/generations",
        {
          model: env.MOOZ_OPENAI_IMAGE_MODEL || "gpt-image-1",
          prompt,
          n: 1,
          background:input.background||"auto",
          quality: ["low", "medium", "high"].includes(input.quality)
            ? input.quality
            : "medium",
          size,
        },
        { Authorization: "Bearer " + key },
      );
      if (!r.data?.[0]?.b64_json) throw Error("API chưa trả dữ liệu ảnh.");
      return {
        kind: "image",
        url: "data:image/png;base64," + r.data[0].b64_json,
      };
    }
    const r = await request(
      "https://api.openai.com/v1/chat/completions",
      {
        model: env.MOOZ_OPENAI_TEXT_MODEL || "gpt-4.1-mini",
        messages: [
          {
            role: "user",
            content: refs.length
              ? [
                  { type: "text", text: prompt },
                  ...refs.map((url) => ({
                    type: "image_url",
                    image_url: { url },
                  })),
                ]
              : prompt,
          },
        ],
      },
      { Authorization: "Bearer " + key },
    );
    const text = r.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw Error("API không trả văn bản.");
    return { kind: "text", text };
  }
  const model =
    input.mediaType === "image"
      ? env.MOOZ_GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image"
      : env.MOOZ_GOOGLE_TEXT_MODEL || "gemini-2.5-flash";
  const parts = [
    { text: prompt },
    ...refs.map((url) => ({
      inlineData: {
        mimeType: url.slice(5, url.indexOf(";")),
        data: url.slice(url.indexOf(",") + 1),
      },
    })),
  ];
  const r = await request(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent",
    {
      contents: [{ role: "user", parts }],
      ...(input.mediaType === "image"
        ? { generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig:{aspectRatio:input.size||"1:1"} } }
        : {}),
    },
    { "x-goog-api-key": key },
  );
  const output = r.candidates?.[0]?.content?.parts || [];
  if (input.mediaType === "text") {
    const text = output.map((p) => p.text || "").join("\n");
    if (!text.trim()) throw Error("Gemini không trả văn bản.");
    return { kind: "text", text };
  }
  const image = output.find((p) =>
    /^image\//.test(p.inlineData?.mimeType),
  )?.inlineData;
  if (!image) throw Error("Gemini không trả ảnh.");
  return { kind: "image", url: `data:${image.mimeType};base64,${image.data}` };
}
