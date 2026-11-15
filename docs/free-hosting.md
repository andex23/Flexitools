# Publish the free website

The default Flexitool build is a static website. Visitors' devices perform file processing; there is no video API, upload bucket, API key, subscription, or server to provision.

## GitHub Pages

1. Merge the reviewed feature branch when ready.
2. In the repository's **Settings → Pages**, set the publishing source to **GitHub Actions**.
3. Open **Actions → Publish free website → Run workflow** on the default branch.
4. The workflow installs dependencies, runs the frontend tests, builds with the correct Pages base path, and publishes the static artifact. Its deployment output supplies the URL.

The workflow is manual so a push does not publish unfinished work. GitHub only exposes manual workflow dispatch after the workflow exists on the default branch. The public repository can use GitHub Free; no purchased domain is required. Pages is intended for projects such as this open-source toolbox and has [usage/hosting restrictions](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Cloudflare Pages Free

Connect the repository through Cloudflare Pages and select the Free plan. Set:

- Build command: `npm run build`
- Output directory: `build`
- Environment: `NODE_VERSION=22`, `GENERATE_SOURCEMAP=false`
- Leave `PUBLIC_URL` unset for the root of the provided `pages.dev` domain.

No Functions, Workers, R2 bucket, or other paid service is needed. Do not enable a paid add-on. The Free plan has [published limits](https://developers.cloudflare.com/pages/platform/limits/), including 500 builds/month and 25 MiB per deployed asset. Source maps are disabled in the Pages workflow to reduce published assets. Local video input sizes are independent of these asset limits.

## Browser requirements

Serve over HTTPS. Preserve ordinary `.js` MIME types, and allow the local decoder's `blob:` web worker if you add a custom Content Security Policy. No cross-origin isolation headers or remotely hosted FFmpeg files are required. Files remain local, but the initial website, fonts, and decoder assets still require normal network requests. This is not an offline service-worker app.

Large media support depends on codecs and direct file saving in the visitor's browser. Hosting for free does not make browser resource limits disappear. The app states its bounds, supports cancellation, and reports unsupported inputs instead of uploading them to a paid fallback.
