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
