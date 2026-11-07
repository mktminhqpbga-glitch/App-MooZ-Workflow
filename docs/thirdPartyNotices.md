# Distribution notices

Toonflow upstream HBAI-Ltd, MIT, baseline 6086cdffceb704a632eca143dd16cd461a78cdac. The upstream MIT terms are preserved verbatim in docs/toonflowMitLicense.txt. Root LICENSE covers the combined GPL distribution.

Intel compatibility packager restored from official Toonflow v2.0.8, commit af6e884c3d8cda353acaf8ef13aea8ea754a4afd, compat/macIntel and macOS packaging hooks (MIT). Electrobun 1.18.1 is used for x86_64 macOS 13; current Canvas and server sources are retained.

Batch composer contracts adapted from mktminhqpbga-glitch/app-mooz at b7dee161cd6c08bb6e8aa1b7d6d39c5a5f3fe2c5, desktop/batch/composer.js, GPL-2.0-or-later. Adapted source retains attribution and the GPL in apps/server/src/utils/batch. A combined distribution incorporating this module is provided under GPL-2.0-or-later with corresponding source in this repository; original MIT notices remain applicable to upstream components.

Chrome extension Muse adapter: separate GPL-2.0-or-later distribution. Its source, notices and license are included in the extension ZIP. See apps/chromeExtension/bridge/source.md.

Bundled FFmpeg/ffprobe are separate executable programs from eugeneware/ffmpeg-static b6.1.1, downloaded from official GitHub releases and checked against pinned SHA256 values in packages/ffmpeg/src/catalog.ts. Their GPL license accompanies the binaries. FFmpeg source/build instructions: https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1 and https://ffmpeg.org/download.html .

No Apple Developer ID or notarization credentials have been supplied. A successful unsigned build must not be described as notarized or as tested on a user's Ventura machine.
