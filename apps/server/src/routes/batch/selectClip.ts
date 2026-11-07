import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

export default Router().post("/", validateFields({ directory: z.string().min(1).max(4096), id: z.uuid(), jobId: z.uuid(), sceneIndex: z.number().int().min(0).max(11), path: z.string().min(1).max(4096) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const directory = await u.workspace.resolveWorkspace(req, req.body.directory);
  res.set("Cache-Control", "no-store").json(success(await u.batch.selectClip(directory, req.body.id, req.body.jobId, req.body.sceneIndex, req.body.path)));
});
