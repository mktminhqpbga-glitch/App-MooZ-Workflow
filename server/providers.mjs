export const apiProviders = {
  openai: {
    name: "OpenAI API",
    types: ["text", "image"],
    key: "MOOZ_OPENAI_KEY",
  },
  google: {
    name: "Google Gemini API",
    types: ["text", "image"],
    key: "MOOZ_GOOGLE_KEY",
  },
};
export async function generateAPI(
  input,
  { env = process.env, fetchImpl = fetch, signal } = {},
) {
  const p = apiProviders[input.provider],
    key = p && env[p.key];
  if (!key) throw Error("Chưa cấu hình khóa API trên máy chủ.");
  if (!p.types.includes(input.mediaType))
    throw Error("API này chưa hỗ trợ đầu ra đã chọn. Dùng tab AI cho video.");
  const prompt = input.prompt,
    refs = input.referenceImages || [];
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    prompt.length > 50000 ||
    refs.length > 8 ||
    refs.some(
      (r) =>
        typeof r !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r),
    ) ||
    refs.join("").length > 24 * 1024 * 1024
  )
    throw Error("Prompt hoặc ảnh tham chiếu không hợp lệ.");
  const request = async (url, body, headers) => {
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: signal || AbortSignal.timeout(240000),
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw Error(
        "API trả HTTP " +
          res.status +
          ". Kiểm tra lượt đã gửi trước khi chạy lại.",
      );
    const text = await res.text();
    if (text.length > 50 * 1024 * 1024) throw Error("Kết quả API quá lớn.");
    return JSON.parse(text);
  };
  if (input.provider === "openai") {
    if (input.mediaType === "image") {
      if (refs.length)
        throw Error(
          "OpenAI tạo ảnh trong bản web hiện chỉ nhận prompt; dùng Gemini hoặc tab AI để dùng ảnh tham chiếu.",
        );
      const r = await request(
        "https://api.openai.com/v1/images/generations",
        {
          model: env.MOOZ_OPENAI_IMAGE_MODEL || "gpt-image-1",
          prompt,
          n: 1,
          quality: ["low", "medium", "high"].includes(input.quality)
            ? input.quality
            : "medium",
          size:
            input.size === "9:16"
              ? "1024x1536"
              : input.size === "16:9"
                ? "1536x1024"
                : "1024x1024",
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
        ? { generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }
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
