# MooZ CVN

Web workspace inspired by the user-supplied LibTV screenshots and recordings. Built in `App-MooZ-Workflow`; selected transport, dispatch and local image editing modules are reused from `mktminhqpbga-glitch/app-mooz` 0.69.0 under GPL-2.0-or-later. See `vendor/mooz/NOTICE.md` and LICENSE. No LibTV API, model, branding or assets are bundled.

## Run

Node.js 22+ (tested on 24):

```sh
npm ci
npm start
```

Default listener: loopback port 4174. Full AI/Chrome functions require this Node server; `npm run build` creates a static frontend for layout/local-data review only. Static hosting alone does not provide `/api/*`, Chrome relay or generation. Use HTTPS when hosting externally; Web Locks and clipboard require a secure context. Set `HOST=0.0.0.0` and a strong `MOOZ_ACCESS_TOKEN` for external binding, then enter that access code in Settings. This is a single-operator server, not a multi-user SaaS backend.

Optional environment variables are documented in `.env.example`. Supply their values securely in hosting environment settings; do not put keys in browser code, chat, URLs or Git. `.env` is ignored and is not automatically loaded. Keep verification/TLS enabled. The browser only receives provider readiness, never key values. Credentials are used only with fixed official provider destinations.

## Working areas

- **Home:** create, rename, duplicate, open, import and export local projects; reopen without losing data; stale revisions are rejected.
- **Canvas:** stable typed graph, actual wires, connected-input execution, pan/zoom/fit, node and multiselection drag, groups, undo/redo, floating prompt editor, one AI/tab per submitted graph, preview and download actual results. Save prompts and templates to their own stores; reinsert them with fresh node IDs.
- **Batch image/video:** one job per prompt line, optional reference image or saved flow, immutable graph/input Blob snapshots, one provider/tab across each job, queue per resource, cancellation, history and explicit result reconciliation. Closing a browser interrupts its scheduler; it does not keep browser-side processing alive on a server.
- **Kho:** separate Inputs, Results, Prompts and Flow templates, with separate IndexedDB stores. Search/filter/rename/delete. Project-referenced media cannot be deleted until detached. Deleting history does not delete result media. Prompt records are editable. Uploaded media is decoded before acceptance.
- **Local media:** original image editor retained from MooZ with an output adapter; edits create new Results and preserve source bytes. Capturing a video frame creates a PNG Result. Unsupported codecs are reported; these are not AI enhancement tools.
- **Connections:** downloadable MooZ Connect 1.9.2, local pairing, optional existing WSS broker configuration, refresh/check tabs and explicit resume after a provider hold. Local pairing only works when Chrome is on the Node machine. For cloud hosting, configure a compatible WSS relay with the server's admin key.
- **API:** OpenAI text and prompt-only image generation; Gemini text and image with optional image references. Models depend on account access and may need environment overrides. Video is via supported Chrome AI tabs, not an implemented generic video API.
- **Appearance:** dark/light, accent, density and reduced motion, retained locally.

## Data and request safety

IndexedDB is local to each browser origin; there is no cloud project sync. Metadata export differs from a full-media backup. Use **Sao lưu** on canvas or **Sao lưu kèm media** in project details to include referenced media (100 MB total); import restores new project/asset IDs. Exported graphs whitelist properties and omit session credentials/tab assignments. Desktop JSON and this web schema are not interchangeable.

`.mooz-runtime/` contains the Node-side request ledger and dispatch holds. Keep it on a persistent disk across deployments; do not commit it. Duplicate request IDs with the same payload reuse the recorded result; a changed payload is refused. The server records `sent` before an operation. After restart, an unresolved request is never silently resent. Browser jobs interrupted after a send become **Cần đối chiếu** and can retrieve completed server results by ID. A stop request does not undo an AI submission already made.

## Validation

```sh
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
npm run build
```

Browser tests need Chromium and FFmpeg (only for generating a real MP4 test fixture). If using Playwright's bundled browser, install it with `npx playwright install chromium` and omit CHROMIUM_PATH. Tests use isolated browser profiles and temporary servers on 4191–4193. Optional `REVIEW_DIR` writes screenshots. AI responses in browser integration tests are explicit fixtures. The actual Chrome transport is exercised against an authenticated protocol fixture; live paid AI, external WSS and real user sessions have not been verified.

See [implementation status and remaining gaps](docs/IMPLEMENTATION-STATUS.md). This is a new web implementation, not a finished desktop replacement.
