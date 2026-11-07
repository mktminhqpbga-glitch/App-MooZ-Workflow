import { startRelay } from "./server";

const relay = await startRelay({
  controllerToken: process.env.TOONFLOW_RELAY_CONTROLLER_TOKEN ?? "",
  dataDirectory: process.env.TOONFLOW_RELAY_DATA_DIR ?? "data/chromeRelay",
  port: Number(process.env.PORT ?? 4176),
  host: process.env.TOONFLOW_RELAY_HOST ?? "127.0.0.1",
  publicUrl: process.env.TOONFLOW_RELAY_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL,
});
console.log(`Chrome relay listening at ${relay.url}`);
