// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from app-mooz desktop/batch/composer.js at b7dee161cd6c08bb6e8aa1b7d6d39c5a5f3fe2c5.
import { z } from "zod";

const relativePath = z.string().min(1).max(2048).refine(path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."));
export const batchInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(100000),
  eachLine: z.boolean(),
  grouping: z.enum(["combine", "separate"]),
  mode: z.enum(["text", "images", "frames", "extend"]),
  providerId: z.string().regex(/^[a-z][a-zA-Z0-9]{0,95}$/),
  modelId: z.string().min(1).max(256),
  ratio: z.enum(["9:16", "16:9", "1:1"]),
  duration: z.number().positive().max(3600).optional(),
  resolution: z.string().min(1).max(64).optional(),
  copies: z.number().int().min(1).max(10),
  generateAudio: z.boolean().optional(),
  references: z.array(z.strictObject({
    path: relativePath, mimeType: z.string().regex(/^(image|video)\/[a-z0-9.+-]+$/i),
    role: z.enum(["product", "character", "firstFrame", "lastFrame", "sourceVideo"]),
    tag: z.string().regex(/^@anh[1-9]\d{0,2}$/),
  })).max(64),
});
export type BatchInput = z.infer<typeof batchInputSchema>;
export type BatchReference = BatchInput["references"][number];
export type BatchPlan = { label: string; scenes: string[]; references: BatchReference[] };

export function prompts(text: string, eachLine = true): string[][] {
  const rows = (eachLine ? text.split(/\r?\n/) : text.split(/\r?\n\s*\r?\n/))
    .map(row => row.split(/\r?\n/).map(scene => scene.trim()).filter(Boolean)).filter(row => row.length);
  if (!rows.length || rows.length > 100) throw new Error("Nhập từ 1 đến 100 yêu cầu video.");
  if (rows.some(row => row.length > 12 || row.some(scene => scene.length > 4000))) throw new Error("Mỗi video tối đa 12 cảnh; mỗi cảnh tối đa 4.000 ký tự.");
  return rows;
}

export function planBatch(input: BatchInput): BatchPlan[] {
  const rows = prompts(input.text, input.eachLine);
  if (new Set(input.references.map(ref => ref.tag)).size !== input.references.length) throw new Error("Thẻ ảnh tham chiếu bị trùng.");
  const products = input.references.filter(ref => ref.role === "product");
  const characters = input.references.filter(ref => ref.role === "character");
  const frames = input.references.filter(ref => ref.role === "firstFrame" || ref.role === "lastFrame");
  const videos = input.references.filter(ref => ref.role === "sourceVideo");
  if (input.references.some(ref => ref.role === "sourceVideo" ? !ref.mimeType.startsWith("video/") : !ref.mimeType.startsWith("image/"))) throw new Error("Vai trò ảnh/video không khớp loại file.");
  if (input.mode === "text" && input.references.length) throw new Error("Chế độ văn bản không nhận ảnh/video; chọn chế độ tham chiếu.");
  if (input.mode === "images" && (!products.length && !characters.length || frames.length || videos.length)) throw new Error("Chọn ảnh sản phẩm/nhân vật cho chế độ tham chiếu ảnh.");
  if (input.mode === "frames" && (frames.filter(ref => ref.role === "firstFrame").length !== 1 || frames.filter(ref => ref.role === "lastFrame").length > 1 || products.length || characters.length || videos.length)) throw new Error("Chọn một khung đầu và tối đa một khung cuối.");
  if (input.mode === "extend" && (videos.length !== 1 || frames.length || products.length || characters.length)) throw new Error("Chọn đúng một video nguồn để nối tiếp.");
  const groups = input.grouping === "separate" && products.length ? products.map(product => [product, ...characters]) : [input.references];
  if (groups.length * rows.length * input.copies > 100) throw new Error("Một đợt tối đa 100 video. Giảm số ảnh, prompt hoặc bản sao.");
  const plans: BatchPlan[] = [];
  for (const [groupIndex, references] of groups.entries()) for (const [rowIndex, scenes] of rows.entries()) for (let copy = 0; copy < input.copies; copy++) {
    for (const scene of scenes) for (const tag of scene.match(/@anh[1-9]\d*/g) ?? []) {
      if (!references.some(ref => ref.tag === tag)) throw new Error(`${tag} không có trong nhóm ảnh ${groupIndex + 1}. Kiểm tra bảng tác vụ trước khi chạy.`);
    }
    plans.push({ label: `${input.name} · ${groupIndex + 1}.${rowIndex + 1}.${copy + 1}`, scenes, references: structuredClone(references) });
  }
  if (plans.reduce((total, plan) => total + plan.scenes.length, 0) > 300) throw new Error("Một đợt tối đa 300 lượt tạo clip.");
  return plans;
}

export type BatchOutput = { path: string; mimeType: string };
export type BatchScene = { prompt: string; taskId: string; state: string; outputs?: BatchOutput[]; selectedPath?: string; request?: Record<string, unknown>; error?: string };
export type BatchJob = BatchPlan & { id: string; scenes: string[]; clips: BatchScene[]; state: string; output?: BatchOutput; error?: string };
export type BatchView = { id: string; name: string; directory: string; running: boolean; createdAt: number; error?: string; jobs: BatchJob[]; input: BatchInput };
