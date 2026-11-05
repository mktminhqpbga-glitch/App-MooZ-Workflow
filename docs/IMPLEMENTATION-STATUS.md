# Implementation status — MooZ CVN

Reference: supplied partner handbook for MooZ Agent 0.69.0; original repository `mktminhqpbga-glitch/app-mooz`. User reference screenshots/videos establish the LibTV-inspired presentation. The web has its own validated project schema; it does not import the old trial website or assume Electron services exist in a browser.

## Delivered web scope

The six agreed areas now have real local behavior: Canvas, Batch Images, Batch Videos, separate Kho stores, AI Connections, Appearance, plus the project dashboard. The engine validates ports/cycles and executes only connected sources. Browser jobs take graph and input Blob snapshots, use one provider/tab, serialize by resource with Web Locks, persist before requests and never automatically resubmit uncertain jobs. Node-side ledgers provide request-ID idempotency; original Chrome relay/AIDispatch provide pairing and send gates.

Local image editing and local frame extraction are genuine pixel operations. Backups include media and remap imported IDs. Prompt/flow libraries contain real user records; template insertion gives new node/edge/group IDs and omits old generation output assets. No AI results are shown unless a decoded media Blob or actual text response is accepted.

## Changes needed for web portability

- Electron IPC/file paths/windows are replaced by browser IndexedDB and explicit Node HTTP endpoints. This is not a direct transplant of desktop persistence.
- Server keys remain in process environment; the browser only holds an optional server access code for the session. Single-operator external hosting must set an access token and use HTTPS. Multi-user accounts and tenant isolation are not implemented.
- Local Chrome pairing requires co-location with Node; a cloud instance needs an accessible WSS broker. The reused protocol files do not deploy that broker automatically. Proxy-specific WebSocket options may need deployment-specific configuration.
- Browser-local work and data do not survive closing the browser as running processes. Request ledgers on Node preserve known send/results, and unknown browser jobs require reconciliation. This differs from a continuously running server queue.
- Only a declared subset of graph types is supported. Generic video references, detailed model controls on external sites and opaque remote media URLs are refused where safe transport has not been implemented; users can import downloaded results into Kho instead.

## Not yet equivalent to the desktop handbook

- Posting/account connections, scheduling/social delivery, Affiliate Shopee, storyboard extraction and integrated finishing/export of multi-scene films.
- Full desktop media processing (clip merge, subtitles, voiceover, soundtrack sync, advanced timeline).
- LibTV-specific AI HD, AI region editing, multi-angle generation, layer separation, panorama and motion capture.
- Full desktop graph migration, trash/recovery of entire projects, multiple Chrome devices and automatic selection among empty tabs.
- Streaming progress/notifications, account authentication, cloud database synchronization and production deployment automation.
- Real-account end-to-end AI/WSS testing and desktop installers for the new repo.

These are remaining development items, not hidden successful checks. The current implementation supports the six main areas at a web baseline; the complete feature set described in the handbook remains larger.

## Verification evidence

Unit tests cover graph typing/topological order/cycles, exact undo/redo, property whitelisting, idempotency, payload collision rejection, serial tab work, uncertain responses across restart, API host/credential handling, and the authenticated original Chrome protocol against a fake extension.

Browser tests cover actual project CRUD/import/export, revision conflicts, graph execution and persistence with AI fixture responses, distinct batch jobs, separate Inputs/Results/Prompt stores, deletion protection, pixel-accurate image mirroring, source preservation, complete media backup/restore with new IDs, actual MP4 frame extraction, and mobile layouts. No claim of live AI readiness is made without credentials and real service checks.
