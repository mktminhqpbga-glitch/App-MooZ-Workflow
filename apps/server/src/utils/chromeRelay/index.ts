import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { startRelay } from "@toonflow/chrome-relay/server";
import { z } from "zod";
import conf from "@/utils/conf";
import { isEnabled } from "@/utils/multiTenant/mode";

async function relay<T>(path: string, body?: unknown): Promise<T> {
  if (isEnabled()) throw Object.assign(new Error("Chrome Connect is currently available in standalone mode"), { status: 403 });
  const configurations = conf.get("settings", {}).mediaProviderConfigs as Record<string, unknown> | undefined;
  const config = z.object({ relayUrl: z.url(), controllerToken: z.string().min(32).max(256) }).parse(configurations?.museChrome);
  const url = new URL(config.relayUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !(url.protocol === "https:" || url.protocol === "http:" && url.hostname === "127.0.0.1")) throw new Error("Relay requires HTTPS or loopback HTTP");
  const response = await fetch(new URL(path, url), {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(75_000),
    headers: { Authorization: `Bearer ${config.controllerToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Object.assign(new Error(`Chrome relay HTTP ${response.status}`), { status: 502 });
  return await response.json() as T;
}
export async function pair(label: string) { return relay<{ pairingUri: string; expiresIn: number }>("/api/pair", { label }); }
export async function devices() {
  const connected = z.array(z.object({ deviceId: z.uuid(), epoch: z.uuid(), label: z.string() })).max(32).parse(await relay("/api/devices"));
  return Promise.all(connected.map(async device => {
    const tabs = await relay("/api/call", { ...device, tabId: 0, operation: "tabs.query", payload: {} });
    return { ...device, tabs: z.array(z.object({ id: z.number().int().nonnegative(), url: z.url(), title: z.string().optional() })).parse(tabs) };
  }));
}

let localRelay: Awaited<ReturnType<typeof startRelay>> | undefined;
let localRelayError = "";
export function localStatus() { return localRelay ? { state: "ready", url: localRelay.url } : { state: localRelayError ? "error" : "disabled", message: localRelayError }; }
export async function startLocalRelay() {
  if (localRelay) return;
  const settings = conf.get("settings", {});
  const configurations = settings.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const existing = configurations?.museChrome ?? {};
  if (typeof existing.relayUrl === "string" && existing.relayUrl.startsWith("https://")) return;
  let port = 4176;
  try { if (typeof existing.relayUrl === "string") {
    const url = new URL(existing.relayUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Relay cục bộ cần địa chỉ loopback hợp lệ.");
    port = Number(url.port || 80);
  } } catch (error) { localRelayError = error instanceof Error ? error.message : "Địa chỉ relay không hợp lệ"; return; }
  const controllerToken = typeof existing.controllerToken === "string" && existing.controllerToken.length >= 32 ? existing.controllerToken : randomBytes(32).toString("hex");
  try {
    try { localRelay = await startRelay({ controllerToken, port, dataDirectory: join(dirname(conf.path), "chromeRelay") }); }
    catch (error) {
      if (existing.relayUrl || (error as { code?: string }).code !== "EADDRINUSE") throw error;
      localRelay = await startRelay({ controllerToken, port: 0, dataDirectory: join(dirname(conf.path), "chromeRelay") });
    }
    // Persist the exact bound endpoint and credential before the UI can pair Chrome.
    conf.set("settings", { ...settings, mediaProviderConfigs: { ...configurations, museChrome: { ...existing, relayUrl: localRelay.url, controllerToken } } });
    localRelayError = "";
  } catch (error) {
    await localRelay?.stop(); localRelay = undefined;
    localRelayError = error instanceof Error ? error.message : "Không khởi động được relay cục bộ";
    console.error("Chrome Connect:", localRelayError);
  }
}
