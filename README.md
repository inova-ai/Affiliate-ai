# LUXMOTION AI v18.3.3 — Vercel Hardened

This build is audited for Vercel/Node.js 24 and the following production paths:

- Runway image/video generation
- Seedance 2.5 motion transfer
- Browser asset upload without sending large media through a Vercel Function
- Auto Production + QC + retry + MP4 composition
- Technical/visual QC
- MP4 composition with bundled FFmpeg/FFprobe
- 4K delivery through Runway Magnific Video Upscaler, with local FFmpeg fallback

## Required Vercel setup

1. Deploy this ZIP as an Express/Node.js project.
2. Use Node.js **24.x**. Node.js 20 is scheduled for Vercel deprecation on October 1, 2026.
3. Connect a **Vercel Blob** store to the project. This is required for durable browser uploads and output files across serverless invocations.
4. Set `RUNWAYML_API_SECRET` in Vercel Environment Variables, or use the browser Runway API Key manager in the UI.
5. Redeploy after connecting Blob and adding environment variables.

### Why Blob is required

Vercel Function filesystems are runtime-local. `/tmp` is used only for processing inside one invocation. Vercel Blob is used for durable input/output media so a later request can retrieve a generated master or source asset.

### Why uploads changed

Vercel Functions reject request payloads above the documented 4.5 MB limit. The browser now requests a short-lived Blob PUT URL and uploads the file directly to Blob, then the server imports the Blob URL into the Runway/reference pipeline.

### FFmpeg

The project includes `ffmpeg-static` and `ffprobe-static` so media processing does not depend on a system `ffmpeg` binary. `FFMPEG_PATH` and `FFPROBE_PATH` can still override the bundled binaries.

## Runtime behavior

On Vercel, `/api/auto-produce` **awaits the entire production pipeline** before returning. It does not start a fire-and-forget background promise, because a serverless invocation may be terminated after the response is sent.

The configured maximum function duration is 300 seconds. Longer jobs should use a Vercel Pro/Enterprise setup with a higher `maxDuration`, or move orchestration to Vercel Workflows/another durable job runner.

## Runway 4K

The 4K delivery path first tries Runway's `magnific_video_upscaler_creative` video-upscale endpoint at `4k`. If that call is unavailable and `RUNWAY_4K_FALLBACK=true` (default), the pipeline falls back to local FFmpeg 4K encoding.

## Local development

```bash
npm install
npm test
npm start
```

Open `http://localhost:8787`.

## Durable Profile / Project persistence

This build persists **Profile** and **Project** metadata to Vercel Blob instead of relying on the Function filesystem:

- `luxmotion/profiles/<profile-id>.json`
- `luxmotion/profiles/<profile-id>/original.*`
- `luxmotion/profiles/<profile-id>/normalized.jpg`
- `luxmotion/profiles/<profile-id>/references/*`
- `luxmotion/projects/<project-id>.json`
- Rendered masters are published under `luxmotion/renders/*`.
- Motion Transfer results are copied to `luxmotion/motion/*` when Blob is available.

Use a **Private Vercel Blob store** for profiles/projects/reference media. The browser never receives the Blob read-write token. It receives short-lived signed upload URLs, and the server reads private objects through the Blob SDK. Vercel Blob supports private storage, server-side `get()`, `list()`, `put()`, and signed URLs for scoped browser operations. See the current Vercel Blob documentation for setup.

The `/api/health` response now exposes `durablePersistence: true` when the Blob store is reachable/configured for the deployment.

### Required storage setup

Create/connect a **Private Blob** store to this Vercel project and enable it for the Production environment. The current Vercel Blob SDK supports OIDC authentication on Vercel, so a long-lived Blob token is not required for new OIDC-connected stores.

Do not use the Vercel Function filesystem as the source of truth. `/tmp/luxmotion` is only a per-invocation working directory for FFmpeg, QC and temporary provider downloads.

## Vercel persistence audit

Profiles, project JSON, reference media, master MP4, 4K MP4, and Motion Transfer outputs use Vercel Blob. Profile/project metadata and source references are private Blob objects. Browser access to private media is granted through short-lived signed GET URLs. `/tmp/luxmotion` is temporary processing space only.

For Vercel Blob OIDC, connect the Blob store to the Vercel project. The connected store exposes `BLOB_STORE_ID`, while Vercel Functions provide the short-lived OIDC token through the request context. The `@vercel/blob` SDK resolves that OIDC credential automatically. A static `BLOB_READ_WRITE_TOKEN` is only needed for stores/projects that still use token authentication.

`GET /api/health` now distinguishes `blobConfigured` from `blobReachable`; durable persistence is true only when the application can actually reach Blob.


## v18.3.3 Blob/Runway bridge fix

Browser media uploads no longer call Runway's `/v1/uploads` initialization flow. The browser uploads to Vercel Blob, then LUXMOTION issues a short-lived signed HTTPS GET URL and passes that URL to Runway. This avoids the Runway ephemeral-upload 403 path seen in production and also avoids Vercel Function payload limits. Runway ephemeral upload remains only as a non-Vercel/local fallback.

Profile, master MP4, segment MP4, motion-transfer output, and 4K delivery are persisted to private Vercel Blob. Project JSON stores Blob pathnames rather than relying on runtime-local files.


## v18.3.3 Blob OIDC detection fix

The previous build incorrectly treated a Vercel OIDC-connected Blob store as unconfigured when `VERCEL_OIDC_TOKEN` was not present in `process.env`. In Vercel Functions the OIDC token is provided in the function request context, while the connected store is identified by `BLOB_STORE_ID`. This build recognizes `BLOB_STORE_ID` and lets `@vercel/blob` resolve the request-scoped OIDC token.


### Runway + Private Blob asset bridge
Runway URL inputs require the asset host to support HTTP HEAD as well as GET. Vercel Blob presigned URLs are scoped to a single operation, so a presigned GET URL is not used directly as a Runway input. Motion Transfer now sends Blob pathnames to the server, downloads the private Blob object temporarily, uploads it to Runway's ephemeral upload API, and submits the resulting Runway URI. This keeps the Blob private while satisfying Runway's asset-fetch contract.


## Runway asset bridge
Motion Transfer Blob assets are exposed to Runway through a short-lived HTTPS bridge endpoint that supports both HEAD and GET, with exact Content-Type and Content-Length. This avoids relying on provider-side fetching of private Blob signed URLs or `runway://` URIs.
