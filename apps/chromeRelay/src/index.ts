import type { ServerWebSocket } from "bun";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resolve } from "node:path";
import { Store, hash, bindingSchema, claimSchema } from "./store";

const controllerToken = process.env.TOONFLOW_RELAY_CONTROLLER_TOKEN ?? "";
if (controllerToken.length < 32 || controllerToken.length > 256) throw new Error("Set TOONFLOW_RELAY_CONTROLLER_TOKEN to a private random value of at least 32 characters");
const port = Number(process.env.PORT ?? 4176);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid relay port");
const publicOrigin = process.env.TOONFLOW_RELAY_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`;
const origin = new URL(publicOrigin);
if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) throw new Error("Relay public URL requires HTTPS or loopback HTTP");
const store = await Store.open(resolve(process.env.TOONFLOW_RELAY_DATA_DIR ?? "data/chromeRelay"));
type Connection = { deviceId?: string; epoch?: string; label?: string; chunks: Map<string, { total: number; body: string; createdAt: number }> };
type Socket = ServerWebSocket<Connection>;
const browsers = new Map<string, Socket>();
const pending = new Map<string, { socket: Socket; resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const operations = new Set(["tabs.query", "tabs.get", "tabs.script", "tabs.message"]);
const identitySchema = z.object({ deviceId: z.string().uuid(), epoch: z.string().uuid(), token: z.string().min(32).max(256), pairing: z.boolean().optional(), type: z.literal("auth") });
const callSchema = bindingSchema.omit({ conversationUrl: true }).extend({ operation: z.string(), payload: z.record(z.string(), z.unknown()) });
const maxMessage = 128 * 1024 * 1024;
const failure = (error: unknown, status = 409) => Response.json({ error: error instanceof Error ? error.message : "Relay request failed" }, { status });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function send(socket: Socket, value: unknown) {
  const text = JSON.stringify(value);
  if (text.length > maxMessage) throw new Error("Message exceeds relay limit");
  if (text.length < 32_000) { if (socket.send(text) === 0) throw new Error("Browser disconnected"); return; }
  const id = crypto.randomUUID();
  for (let offset = 0; offset < text.length; offset += 32_000) {
    while (socket.getBufferedAmount() > 256_000) { if (socket.readyState !== 1) throw new Error("Browser disconnected"); await sleep(10); }
    if (socket.send(JSON.stringify({ type: "chunk", id, offset, total: text.length, body: text.slice(offset, offset + 32_000) })) === 0) throw new Error("Browser disconnected");
  }
}
function browser(deviceId: string, epoch: string) {
  const socket = browsers.get(deviceId);
  if (!socket || socket.readyState !== 1 || socket.data.epoch !== epoch) throw new Error("Waiting for the selected Chrome device/session");
  return socket;
}
async function call(input: z.infer<typeof callSchema>) {
  if (!operations.has(input.operation)) throw new Error("Operation is not allowed");
  const socket = browser(input.deviceId, input.epoch), id = crypto.randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Chrome response uncertain; reconcile the existing request")); }, 60_000);
    pending.set(id, { socket, resolve, reject, timer });
    send(socket, { type: "request", id, operation: input.operation, payload: input.payload }).catch(error => {
      clearTimeout(timer); pending.delete(id); reject(error);
    });
  });
}
async function ingest(socket: Socket, value: unknown): Promise<void> {
  const message = z.record(z.string(), z.unknown()).parse(value);
  if (!socket.data.deviceId) {
    const input = identitySchema.parse(message);
    if (browsers.has(input.deviceId)) throw new Error("Device is already connected");
    const auth = await store.authenticate(input.deviceId, input.token, input.pairing === true);
    if (browsers.has(input.deviceId)) throw new Error("Device is already connected");
    Object.assign(socket.data, { deviceId: input.deviceId, epoch: input.epoch, label: auth.label });
    browsers.set(input.deviceId, socket);
    await send(socket, { type: "ready", ...auth, protocol: 1 });
    return;
  }
  if (message.type === "ping") { await send(socket, { type: "pong" }); return; }
  if (message.type === "chunk") {
    const chunk = z.object({ id: z.string().uuid(), offset: z.number().int().nonnegative(), total: z.number().int().positive().max(maxMessage), body: z.string().max(32_000) }).parse(message);
    for (const [id, value] of socket.data.chunks) if (value.createdAt + 60_000 < Date.now()) socket.data.chunks.delete(id);
    let current = socket.data.chunks.get(chunk.id);
    if (!current) {
      if (socket.data.chunks.size >= 2 || chunk.offset !== 0) throw new Error("Invalid chunk sequence");
      current = { total: chunk.total, body: "", createdAt: Date.now() }; socket.data.chunks.set(chunk.id, current);
    }
    if (chunk.total !== current.total || chunk.offset !== current.body.length || chunk.offset + chunk.body.length > chunk.total) throw new Error("Invalid chunk sequence");
    current.body += chunk.body;
    if (current.body.length === current.total) { socket.data.chunks.delete(chunk.id); await ingest(socket, JSON.parse(current.body)); }
    return;
  }
  if (message.type === "response" && typeof message.id === "string") {
    const request = pending.get(message.id);
    if (!request || request.socket !== socket) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (typeof message.error === "string") request.reject(new Error(message.error.slice(0, 2000)));
    else request.resolve(message.result);
    return;
  }
  if (message.type === "gate") {
    const input = z.object({ callId: z.string().uuid(), tabId: z.number().int().nonnegative(), message: z.object({ requestId: z.string().uuid(), token: z.string().length(64), operation: z.enum(["prepare", "permit", "sent", "block"]) }) }).parse(message);
    const result = await store.gate(socket.data.deviceId, socket.data.epoch!, input.tabId, input.message);
    await send(socket, { type: "gate-result", callId: input.callId, result });
  }
}

const server = Bun.serve<Connection>({
  port, hostname: process.env.TOONFLOW_RELAY_HOST ?? "127.0.0.1", maxRequestBodySize: 64 * 1024 * 1024,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, protocol: 1 });
    if (url.pathname === "/connect" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      if (server.upgrade(request, { data: { chunks: new Map() } })) return undefined;
      return new Response("Upgrade failed", { status: 400 });
    }
    const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!timingSafeEqual(Buffer.from(hash(supplied), "hex"), Buffer.from(hash(controllerToken), "hex"))) return failure("Unauthorized", 401);
    try {
      if (request.method === "POST" && url.pathname === "/api/pair") {
        const { label } = z.object({ label: z.string().trim().min(1).max(100) }).parse(await request.json());
        const token = await store.pair(label);
        const endpoint = new URL("/connect", origin); endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
        const uri = new URL("toonflow-connect://pair"); uri.searchParams.set("endpoint", endpoint.href); uri.searchParams.set("token", token);
        return Response.json({ pairingUri: uri.href, expiresIn: 300 });
      }
      if (request.method === "GET" && url.pathname === "/api/devices") return Response.json([...browsers.values()].map(socket => ({ deviceId: socket.data.deviceId, epoch: socket.data.epoch, label: socket.data.label })));
      if (request.method === "POST" && url.pathname === "/api/call") return Response.json(await call(callSchema.parse(await request.json())));
      if (request.method === "POST" && url.pathname === "/api/dispatch") return Response.json(await store.claim(claimSchema.parse(await request.json())));
      if (request.method === "GET" && url.pathname.startsWith("/api/dispatch/")) {
        const claim = store.get(z.uuid().parse(url.pathname.slice(14)));
        return claim ? Response.json(claim) : failure("Unknown dispatch", 404);
      }
      if (request.method === "POST" && url.pathname === "/api/ack") {
        const { requestId } = z.object({ requestId: z.uuid() }).parse(await request.json());
        const claim = store.get(requestId);
        if (!claim) return failure("Unknown dispatch", 404);
        if (claim.phase === "complete") return Response.json({ ok: true });
        const result = await call({ ...claim, operation: "tabs.message", payload: { id: claim.tabId, message: { type: "MUSEFLOW_JOB_ACK", requestId } } }) as { ok?: boolean };
        if (!result?.ok) throw new Error("Chrome has not acknowledged the saved result");
        return Response.json(await store.acknowledge(requestId));
      }
      return failure("Not found", 404);
    } catch (error) { return failure(error, error instanceof z.ZodError ? 400 : 409); }
  },
  websocket: {
    maxPayloadLength: 128_000, idleTimeout: 60,
    open(socket) { setTimeout(() => { if (!socket.data.deviceId) socket.close(1008, "Authentication required"); }, 10_000); },
    message(socket, raw) {
      try { const value = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); void ingest(socket, value).catch(() => socket.close(1008, "Invalid relay message or authentication")); }
      catch { socket.close(1008, "Invalid JSON"); }
    },
    close(socket) {
      if (socket.data.deviceId && browsers.get(socket.data.deviceId) === socket) browsers.delete(socket.data.deviceId);
      for (const [id, task] of pending) if (task.socket === socket) { clearTimeout(task.timer); pending.delete(id); task.reject(new Error("Chrome disconnected; do not resubmit the prompt")); }
    },
  },
});
console.log(`Chrome relay listening on ${server.hostname}:${server.port}`);
