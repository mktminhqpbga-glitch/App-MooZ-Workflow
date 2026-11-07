import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), clips: z.array(z.strictObject({ path: z.string().min(1).max(4096), mimeType: z.string().startsWith("video/") })).min(1).max(100), ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  const output = `postExports/${crypto.randomUUID()}/merged.mp4`;
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  try { res.json(success(await u.mediaRender.mergeVideo(directory, req.body.clips, output, req.body.ratio, controller.signal))); }
  finally { res.off("close", close); }
});
