# Toonflow + Muse Chrome Connect

This branch imports Toonflow upstream `6086cdffceb704a632eca143dd16cd461a78cdac`.
The previous MooZ/Swift app is preserved in Git history and the external backup;
it is no longer the active application. The original Toonflow Canvas is retained.

## What is implemented

- `apps/chromeRelay`: a single-owner relay with authenticated controller HTTP,
  authenticated browser WebSockets, one-use five-minute pairing codes, stable
  browser/session identity, chunked transport, durable dispatch grants and a
  ten-second cooldown measured after successful ACK.
- `apps/chromeExtension`: Manifest V3 companion for Muse. Device UUID survives
  worker restarts; browser session epoch changes when Chrome restarts. Submission
  intent is saved before contacting the tab. An ambiguous send is reconciled,
  never automatically repeated. The same extension can run on the app's machine,
  another computer, or a VM with outbound access to the relay.
- `Muse · Chrome` provider in the existing Toonflow media catalog. It retains
  task UUID, input bytes, prompt and device/session/tab/chat binding in private
  task checkpoints; verifies the exact-turn receipt; returns real image bytes.
- **Settings → Media models → Chrome Connect** saves the relay connection,
  issues pairing codes, lists connected browsers/tabs and pins the target for
  new tasks. Existing task checkpoints keep their original browser binding.
- Provider ACK happens after output files and the successful host task are
  persisted. An ACK failure keeps polling and retries ACK only. All returned
  files are retained by the host; the stock image node still previews its first
  result. This change does not add a new multi-image node gallery.

The relay is intentionally separate from Toonflow's backend. It is not a public
deployment of the unauthenticated standalone project/file API. Chrome Connect
currently supports standalone Toonflow, not its unfinished multi-tenant mode.

## Build and run locally

Use Bun **1.4.3**, the version declared by upstream. Install from official sources
with normal checksum/TLS verification. The lockfile uses the official npm registry;
versions and integrity hashes were retained when replacing upstream mirror URLs.

```sh
bun install --frozen-lockfile
bun run build:server
bun run build:chromeExtension
```

The Linux `bun run build` filter issue is already documented in upstream's
desktop build script. `build:server` is the supported full standalone build path.

For a local relay, create `apps/chromeRelay/.env` privately, containing a freshly
generated secret of at least 32 random characters. Never commit this file:

```dotenv
TOONFLOW_RELAY_CONTROLLER_TOKEN=YOUR_PRIVATE_RANDOM_SECRET
TOONFLOW_RELAY_DATA_DIR=/absolute/path/to/private/chromeRelayData
```

```sh
bun run dev:chromeRelay
```

It listens on `127.0.0.1:4176`. For Toonflow development, use a **new isolated data
directory**, not existing user/production data; startup synchronizes plugins and
contains upstream migrations:

```sh
TOONFLOW_DATA_DIR=/absolute/path/to/new/toonflowData bun run start:server
```

The standalone server defaults to loopback. Containers explicitly set
`TOONFLOW_SERVER_HOST=0.0.0.0`; do not expose the standalone project API publicly.

## Deploy the relay on Render

`render.yaml` is ready for a Render Blueprint using this feature branch. It uses
the **paid Starter plan and a persistent disk**, because consumed permissions and
cooldowns must survive restarts. Review those costs/settings before creating it.
Only the relay is deployed; project files stay with the Toonflow app.

Render generates `TOONFLOW_RELAY_CONTROLLER_TOKEN`. Copy its value from your own
Render environment into Toonflow's Chrome Connect settings; do not post it in
chat. Use the relay's HTTPS address. `RENDER_EXTERNAL_URL` supplies the public
pairing endpoint automatically. No Render service has been deployed by this work.

## Pair Chrome on any of the three machines

1. Build or download `toonflowChromeConnect.zip` and extract it. Disable the old
   MooZ Connect extension before using this replacement.
2. In the target Chrome, open `chrome://extensions`, enable Developer mode, choose
   **Load unpacked**, and select the folder containing `manifest.json`.
3. In Toonflow, save the relay URL/controller token. Enter a device label and
   create a pairing code. Paste that code into **Toonflow Chrome Connect** on the
   target computer/VM; grant access to that relay hostname when prompted.
4. Sign in to Muse on that Chrome and open the intended conversation. Refresh
   devices in Toonflow and pin that exact tab. Each Chrome installation/profile
   must be paired separately; do not clone connection tokens between machines.
5. In an image-generation node select **Muse · Chrome**. Select the model on the
   Muse website itself. Add image references/prompt and generate using Toonflow's
   existing node action. No Muse API key is required.

Currently the adapter accepts up to eight input images, approximately 8 MB each,
with a 24 MB aggregate input limit and a 128 MB transport envelope. Website model,
quality and resolution controls have not been verified against the live service.
Website changes, CAPTCHA, account limits or lost DOM receipts may require direct
attention in the original browser; uncertain tasks are not regenerated silently.

## Verification and remaining gates

- Bun 1.4.3 executable verified against its official release checksum.
- Existing type checks for Server, Web, relay and extension; existing standalone
  build plus relay/extension builds have been run. No new test modules, fixtures,
  self-check scripts or test dependencies were added, following upstream AGENTS.
- Actual Toonflow startup in a fresh local data directory; original UI viewed in
  Chromium; `museChrome/museImage` present in the real media catalog.
- Actual relay `/health` responds; unauthenticated controller request returns
  401; Toonflow's real pairing endpoint issues a five-minute code without exposing
  the controller token in its response.
- Cloud Chromium has administrator `ExtensionInstallBlocklist: ["*"]`; it rejected
  this unpacked extension. That policy was not changed. Pairing/DOM generation
  with a real extension, Muse account, other computer or VM remains unaccepted.
- The relay Docker image built successfully with frozen dependencies and a
  session CA secret mount. This is local image evidence, not a Render deployment.
- Render account deployment and actual WSS/restart behavior on Render remain
  unaccepted. Source/build success does not establish a successful Muse image job.
- Official Electrobun 2.0.5 API/types were extracted unchanged from its core archive
  with SHA256 `29deec8eb7f8a017f786f95816bccccd91f514e57ea14868e4b97bd409268e88`.
  Full Hutch prepare remains blocked by network access to the Cottontail CDN.
- Current upstream desktop requires **macOS 14+**. The user explicitly keeps
  Intel Ventura 13. A compatible desktop host/runtime is still required; no new
  macOS installer has been supplied or declared compatible with Ventura.

The old native Swift test counts and installer belong to the archived app and
are not evidence for this Toonflow implementation.
