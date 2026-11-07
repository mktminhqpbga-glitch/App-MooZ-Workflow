import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const secret = () => randomBytes(32).toString("hex");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = z.string().min(1).max(128);
export const bindingSchema = z.object({ deviceId: z.uuid(), epoch: z.uuid(), tabId: z.number().int().nonnegative(), conversationUrl: z.url() });
export const claimSchema = bindingSchema.extend({ requestId: z.uuid(), requestCode: identity, fingerprint: z.string().min(1).max(128) });
export type Binding = z.infer<typeof bindingSchema>;
type Claim = z.infer<typeof claimSchema> & { dispatchToken: string; phase: "registered" | "prepared" | "permitted" | "sent" | "blocked" | "complete"; acknowledgedAt?: number };
const claimRecord = claimSchema.extend({ dispatchToken: z.string().length(64), phase: z.enum(["registered", "prepared", "permitted", "sent", "blocked", "complete"]), acknowledgedAt: z.number().optional() });
const stateSchema = z.object({
  version: z.literal(1),
  devices: z.record(z.string(), z.object({ tokenHash: z.string().length(64), label: z.string().max(100) })),
  pairs: z.record(z.string(), z.object({ expires: z.number(), label: z.string().max(100) })),
  claims: z.record(z.string(), claimRecord),
  cooldowns: z.record(z.string(), z.number()),
  blocks: z.record(z.string(), z.boolean()),
});
type State = z.infer<typeof stateSchema>;
const resource = (value: Binding) => `${value.deviceId}:${value.epoch}:muse`;

/** Single relay instance, private persistent disk. A failed commit never publishes a grant. */
export class Store {
  private state: State;
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private file: string, state: State) { this.state = state; }
  static async open(directory: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "relay.json");
    let state: State;
    try { state = stateSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { version: 1, devices: {}, pairs: {}, claims: {}, cooldowns: {}, blocks: {} };
      await writeAtomic(file, JSON.stringify(state), { mode: 0o600 });
    }
    return new Store(file, state);
  }
  private change<T>(operation: (next: State) => T): Promise<T> {
    const task = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = operation(next);
      await writeAtomic(this.file, JSON.stringify(next), { mode: 0o600 });
      this.state = next;
      return result;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  pair(label: string) {
    const token = secret();
    return this.change(state => {
      for (const [key, pair] of Object.entries(state.pairs)) if (pair.expires < Date.now()) delete state.pairs[key];
      state.pairs[hash(token)] = { expires: Date.now() + 300_000, label };
      return token;
    });
  }
  authenticate(deviceId: string, token: string, pairing: boolean) {
    return this.change(state => {
      if (!pairing) {
        if (state.devices[deviceId]?.tokenHash !== hash(token)) throw new Error("Browser authentication failed");
        return { label: state.devices[deviceId]!.label };
      }
      const pair = state.pairs[hash(token)];
      if (!pair || pair.expires < Date.now() || state.devices[deviceId]) throw new Error("Pair expired, already used, or device already registered");
      const browserToken = secret();
      state.devices[deviceId] = { tokenHash: hash(browserToken), label: pair.label };
      delete state.pairs[hash(token)];
      return { label: pair.label, browserToken };
    });
  }
  claim(input: z.infer<typeof claimSchema>) {
    return this.change(state => {
      const previous = state.claims[input.requestId];
      if (previous) {
        for (const key of Object.keys(input) as (keyof typeof input)[]) if (previous[key] !== input[key]) throw new Error("Request binding or content changed");
        return previous;
      }
      const value: Claim = { ...input, dispatchToken: secret(), phase: "registered" };
      state.claims[input.requestId] = value;
      return value;
    });
  }
  get(requestId: string) { return this.state.claims[requestId]; }
  gate(deviceId: string, epoch: string, tabId: number, input: { requestId: string; token: string; operation: string }) {
    return this.change(state => {
      const claim = state.claims[input.requestId];
      if (!claim || claim.deviceId !== deviceId || claim.epoch !== epoch || claim.tabId !== tabId || claim.dispatchToken !== input.token) return { ok: false, error: "Dispatch identity mismatch" };
      if (claim.phase === "complete") return { ok: false, error: "Request already acknowledged" };
      const key = resource(claim);
      if (input.operation === "block") { state.blocks[key] = true; claim.phase = "blocked"; return { ok: true }; }
      if (state.blocks[key]) return { ok: false, error: "AI service requires attention in the selected browser" };
      if (input.operation === "sent") {
        if (!["permitted", "sent"].includes(claim.phase)) return { ok: false, error: "Missing one-use send permission" };
        claim.phase = "sent"; return { ok: true };
      }
      if (["permitted", "sent", "blocked"].includes(claim.phase)) return { ok: false, error: "Send permission already consumed; reconcile the original request" };
      if (Object.values(state.claims).some(other => other.requestId !== claim.requestId && resource(other) === key && !["registered", "complete"].includes(other.phase))
        || (state.cooldowns[key] ?? 0) > Date.now()) return { ok: true, waiting: true, waitMs: 1000 };
      if (input.operation === "prepare") { claim.phase = "prepared"; return { ok: true }; }
      if (input.operation === "permit" && claim.phase === "prepared") { claim.phase = "permitted"; return { ok: true, expiresAt: Date.now() + 2000 }; }
      return { ok: false, error: "Invalid dispatch transition" };
    });
  }
  acknowledge(requestId: string) {
    return this.change(state => {
      const claim = state.claims[requestId];
      if (!claim) throw new Error("Unknown request");
      if (claim.phase !== "complete") {
        claim.phase = "complete"; claim.acknowledgedAt = Date.now();
        state.cooldowns[resource(claim)] = claim.acknowledgedAt + 10_000;
      }
      return { ok: true };
    });
  }
}
