import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ label: z.string().trim().min(1).max(100) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.json(success(await u.chromeRelay.pair(req.body.label.trim())));
});
