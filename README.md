# Flexitool

A free, open-source toolbox for images, video, audio, PDFs, and CSVs. Every default tool processes files on the visitor's device. No account, uploads, API keys, paid backend, or desktop helper is required.

## Tools

| Tool | What it does |
| --- | --- |
| Compress image | JPG/PNG/WebP, quality presets, optional target size, resize, before/after preview and actual savings |
| Video & audio | Compress to MP4 or WebM, trim, reduce resolution, mute, or extract audio to M4A/Ogg/WAV when supported |
| Batch images | Process images sequentially, download individually or as one ZIP, keep successful results when another file fails |
| Resize image | Custom dimensions, preserved proportions, preset canvases with padding |
| Edit image | Crop, rotate, text watermark, or re-encode without copying source metadata |
| Convert image / HEIC | JPG/PNG/WebP conversion, raster-in-SVG wrappers, and local HEIC primary-photo conversion |
| Create / organize PDFs | Create PDFs, merge, extract/reorder pages, or split selected pages into a ZIP |
| Convert CSV | Convert between CSV, JSON, Excel, and PDF |

Tools load on demand. New media/file workspaces retain their work while you switch tools. Browser memory and CPU are shared between tools, so complete one demanding job before starting another.

## Free hosting

**GitHub Pages** is a suitable starting point for this public open-source toolbox. **Cloudflare Pages Free** is another option. The website serves static assets; selected media never passes through either host. No custom domain purchase is necessary.

- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages): available for public repositories on GitHub Free, subject to its [usage limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
- [Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/): Free plan currently includes 500 builds/month and a 25 MiB limit per site asset. This asset limit does not limit locally selected video files.

See [free hosting instructions](docs/free-hosting.md). The included Pages workflow runs only when manually requested; pushing the feature branch does not publish it.

## Quality and practical limits

“Best quality” prioritizes detail; it does not promise lossless compression, a fixed reduction, or an exact target size. Already compressed files may not become smaller. Review the result before replacing an original. Reducing dimensions, trimming, and removing audio all change the content. PNG uses lossless encoding, but format conversion and color handling can still change a picture.

| Tool | Guardrails |
| --- | --- |
| Still image compression/editing | Up to 100 MiB, 50 megapixels, 16,384 pixels per side; animated PNG/WebP rejected |
| Batch compression | Up to 25 files, 200 MiB combined; individual image limits still apply |
| HEIC conversion | Up to 30 MiB, 50 megapixels, 16,384 pixels per side; primary still photo only; sequence containers rejected |
| PDF organizer | Up to 10 files, 100 MiB combined, 500 pages; encrypted PDFs rejected |
| Browser video/audio | Up to 500 MiB input and 256 MiB output in memory; supported desktop browsers can attempt up to 4 GiB input with direct disk saving |

Video/audio uses Mediabunny and the browser's WebCodecs implementation. Use HTTPS (or localhost). The app probes available codecs and checks each source; recent desktop Chrome/Edge usually offer the most options, but support also depends on the OS and source codec. MP4 uses H.264/AAC and WebM uses VP9/Opus when those encoders are available. An unsupported audio track produces an error; mute explicitly to remove it. Only the primary video/audio tracks are retained. Subtitles, additional tracks, chapters, and source metadata are not preserved. HDR video is rejected to avoid unintended color changes. Maximum duration is 24 hours; dimensions are capped at 40 megapixels and 16,384 pixels per side.

**Multi-GB processing is an attempt, not a reliability guarantee.** Direct saving streams output to a file instead of retaining the finished file in browser memory. It needs a browser with the File System Access API, sufficient free disk and memory, and a supported codec. The page must stay open. Mobile devices and browsers without direct saving use the smaller limits. There is no universal free server handling large videos behind the scenes. [HandBrake](https://handbrake.fr/) remains a free desktop fallback for files the browser cannot handle.

HEIC conversion extracts the primary still image; Live Photo motion, depth data, extra images, HDR, and source metadata are not preserved. The decoder is fetched from this website only when needed. Cancellation discards a pending decode result after that decode finishes. Metadata removal re-encodes pixels without copying source metadata; it can remove color profiles, change colors/size, and does not remove information visibly present in a photo.

PDF organization creates new documents. Digital signatures are not retained, and interactive forms, bookmarks, or attachments may not carry over. Review the output before sharing.

## Run locally

Requirements: Node.js 22+ and npm. No FFmpeg installation is needed for the default website.

```sh
npm ci
npm start
```

Open `http://localhost:3000`. To create a static production build:

```sh
npm run build
```

Publish the `build` directory on a static HTTPS host. Use `PUBLIC_URL=/Flexitools npm run build` for a project hosted at that path; the Pages workflow obtains the correct base path automatically.

## Optional native server

The earlier native FFmpeg implementation remains available for people who already have a suitable machine. It is not connected to the default app and is not needed for free hosting. See [optional native server](docs/optional-native-server.md) for its separate setup and upload/privacy requirements.

## Verification

```sh
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

Tests cover geometry/export behavior, real PDF/ZIP contents, file and resource limits, cleanup, cancellation, stale results, codec capability failures, and media UI settings. Browser video encoding and HEIC decoding depend on real browser codecs; mocked unit tests do not establish visual quality or reliable multi-GB processing. See [verification notes](docs/free-tools-verification.md) for completed checks and remaining manual coverage.

The optional native service has a separate `npm run test:server` suite requiring FFmpeg. Its large-file transport smoke test does not validate browser video processing.

[Added dependency licenses and source](THIRD_PARTY_NOTICES.md). Built by Sch1xo · Acestar Villam Domum.
