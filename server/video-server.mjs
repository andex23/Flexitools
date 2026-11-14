import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const INPUT_FORMATS = 'mov,matroska,webm,avi,mpegts,mpeg,ogg,flv';
const PRESETS = { quality: 18, balanced: 23, small: 28 };
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, body) {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Server limits must be positive integers.');
  return number;
}

function validToken(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const actual = Buffer.from(expected);
  return supplied.length === actual.length && timingSafeEqual(supplied, actual);
}

export function parseSettings(url) {
  const preset = url.searchParams.get('preset') || 'balanced';
  if (!Object.hasOwn(PRESETS, preset)) throw new HttpError(400, 'Choose a valid quality preset.');
  const heightValue = url.searchParams.get('maxHeight') || '0';
  if (!['0', '720', '1080', '2160'].includes(heightValue)) throw new HttpError(400, 'Choose original, 720p, 1080p, or 2160p resolution.');
  const target = url.searchParams.get('targetMB');
  const targetMB = target === null || target === '' ? undefined : Number(target);
  if (targetMB !== undefined && (!Number.isFinite(targetMB) || targetMB < 1 || targetMB > 10240)) throw new HttpError(400, 'Target size must be between 1 and 10,240 MB.');
  const original = url.searchParams.get('filename') || 'video';
  const cleanName = original.replace(/[/\\\u0000-\u001f\u007f]/g, '_').replace(/\.[^/.]+$/, '');
  const name = Array.from(cleanName).slice(0, 100).join('').trim() || 'video';
  return { preset, maxHeight: Number(heightValue), targetMB, filename: `${name}-compressed.mp4` };
}

function startProcess(executable, args, { signal, onProgress, timeoutMs = 120 * 60 * 1000 } = {}) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let settled = false;
    let killTimer;
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000);
      killTimer.unref();
    };
    const timeout = setTimeout(terminate, timeoutMs);
    timeout.unref();
    signal?.addEventListener('abort', terminate, { once: true });
    if (signal?.aborted) terminate();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', terminate);
      if (error) reject(error); else resolveProcess(value);
    };
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(-256 * 1024);
      if (onProgress) {
        lineBuffer += text;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop().slice(-8192);
        for (const line of lines) {
          const match = /^out_time_us=(\d+)/.exec(line);
          if (match) onProgress(Number(match[1]) / 1_000_000);
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-16 * 1024); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (signal?.aborted) finish(new Error('Operation cancelled.'));
      else if (code !== 0) finish(new Error(stderr || `Video processor exited with code ${code}.`));
      else finish(null, { stdout, stderr });
    });
  });
}

async function inspectVideo(path, executable, signal) {
  const { stdout } = await startProcess(executable, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', INPUT_FORMATS, '-show_entries', 'format=duration:stream=codec_type,width,height,duration,color_transfer', '-of', 'json', path], { signal, timeoutMs: 60_000 });
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(data.format?.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error('This file does not contain a readable video.');
  if (duration > 24 * 60 * 60) throw new Error('Videos longer than 24 hours are not supported.');
  if (video.width * video.height > 40_000_000 || video.width > 16384 || video.height > 16384) throw new Error('This video resolution is too large to process safely.');
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer)) throw new Error('This video uses HDR color. Export an SDR version first so compression does not unexpectedly change its colors.');
  return { width: video.width, height: video.height, duration, hasAudio: data.streams.some((stream) => stream.codec_type === 'audio') };
}

export async function createVideoServer(options = {}) {
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = options.ffprobePath || process.env.FFPROBE_PATH || 'ffprobe';
  const maxFileBytes = parsePositiveInteger(options.maxFileBytes ?? process.env.MAX_UPLOAD_BYTES, 10 * GB);
  const maxDiskBytes = parsePositiveInteger(options.maxDiskBytes ?? process.env.MAX_DISK_BYTES, 32 * GB);
  const maxJobs = parsePositiveInteger(options.maxJobs ?? process.env.MAX_JOBS, 24);
  const maxPendingJobs = parsePositiveInteger(options.maxPendingJobs ?? process.env.MAX_PENDING_JOBS, 4);
  const retentionMs = parsePositiveInteger(options.retentionMs ?? process.env.RETENTION_MS, 60 * 60 * 1000);
  const uploadTimeoutMs = parsePositiveInteger(options.uploadTimeoutMs ?? process.env.UPLOAD_TIMEOUT_MS, 30 * 60 * 1000);
  const publicOriginValue = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const publicOrigin = publicOriginValue ? new URL(publicOriginValue).origin : undefined;
  const allowDevOrigin = options.allowDevOrigin ?? process.env.NODE_ENV !== 'production';
  const buildDirectory = resolve(options.buildDirectory || join(dirname(fileURLToPath(import.meta.url)), '..', 'build'));
  const tempRoot = resolve(options.tempRoot || process.env.VIDEO_TEMP_DIR || join(tmpdir(), 'flexitools-video'));
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  // A restart must not leave old video files around indefinitely. Only inspect our own directory prefix.
  const now = Date.now();
  const orphanedDirectories = new Map();
  let reservedBytes = 0;
  for (const entry of await readdir(tempRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('job-')) {
      const path = join(tempRoot, entry.name);
      const info = await stat(path).catch(() => null);
      if (info && now - info.mtimeMs > retentionMs) await rm(path, { recursive: true, force: true });
      else if (info) {
        let bytes = 0;
        for (const file of await readdir(path)) {
          const fileInfo = await stat(join(path, file)).catch(() => null);
          if (fileInfo?.isFile()) bytes += fileInfo.size;
        }
        orphanedDirectories.set(path, { bytes, expiresAt: info.mtimeMs + retentionMs });
        reservedBytes += bytes;
      }
    }
  }
  let available = false;
  let version;
  try {
    const [ffmpeg] = await Promise.all([
      startProcess(ffmpegPath, ['-version'], { timeoutMs: 5000 }),
      startProcess(ffprobePath, ['-version'], { timeoutMs: 5000 }),
    ]);
    version = ffmpeg.stdout.split('\n')[0].split(' ').slice(0, 3).join(' ');
    available = true;
  } catch { /* The frontend can still run image tools when FFmpeg is missing. */ }

  const jobs = new Map();
  let activeJob = null;
  let closing = false;
  let pendingAdmissions = 0;

  const snapshot = (job) => ({
    id: job.id, status: job.status, progress: job.progress, filename: job.settings.filename,
    inputBytes: job.inputBytes, outputBytes: job.outputBytes, width: job.width, height: job.height,
    duration: job.duration, error: job.error, warning: job.warning,
    expiresAt: job.finishedAt ? new Date(job.finishedAt + retentionMs).toISOString() : undefined,
  });

  const releaseFiles = async (job) => {
    if (job.released) return;
    if (!job.releasePromise) job.releasePromise = (async () => {
      // A deleted-but-open file still consumes disk space. Close active previews/downloads first.
      await Promise.all([...(job.downloadStreams || [])].map((stream) => new Promise((resolveClose) => {
        if (stream.closed) return resolveClose();
        stream.once('close', resolveClose);
        stream.destroy();
      })));
      await rm(job.directory, { recursive: true, force: true });
      reservedBytes -= job.reservation;
      job.reservation = 0;
      job.released = true;
    })().catch((error) => { job.releasePromise = undefined; throw error; });
    await job.releasePromise;
  };

  const encode = async (job) => {
    const signal = job.controller.signal;
    const info = await inspectVideo(job.input, ffprobePath, signal);
    Object.assign(job, { width: info.width, height: info.height, duration: info.duration });
    const maxHeight = job.settings.maxHeight;
    const scale = maxHeight ? `scale=-2:min(trunc(ih/2)*2\\,${maxHeight})` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    const input = ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-format_whitelist', INPUT_FORMATS, '-i', job.input];
    const video = ['-map', '0:v:0', '-vf', scale, '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-threads', '2'];
    const audio = ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k'];
    const output = ['-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', '-fs', String(job.outputLimit), '-progress', 'pipe:1', '-nostats'];
    const progress = (pass, passes) => (seconds) => { job.progress = Math.min(99, Math.round(((pass + Math.min(1, seconds / info.duration)) / passes) * 100)); };
    if (job.settings.targetMB) {
      const targetBytes = job.settings.targetMB * MB;
      // Reserve container overhead; targets are estimates, never guarantees.
      const totalBitrate = targetBytes * 8 * 0.95 / info.duration;
      const audioBitrate = info.hasAudio ? 128000 : 0;
      const videoBitrate = Math.floor(totalBitrate - audioBitrate);
      if (videoBitrate < 100000) throw new Error('That target is too small for this video. Increase the target size or shorten the video.');
      const passlog = join(job.directory, 'pass');
      await startProcess(ffmpegPath, [...input, ...video, '-b:v', String(videoBitrate), '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'null', '-progress', 'pipe:1', '-nostats', '-'], { signal, onProgress: progress(0, 2) });
      await startProcess(ffmpegPath, [...input, ...video, '-b:v', String(videoBitrate), '-pass', '2', '-passlogfile', passlog, ...audio, ...output, job.output], { signal, onProgress: progress(1, 2) });
      job.warning = 'Target size is approximate. Encoding to a fixed size can reduce visible quality; compare the downloaded video with your original.';
    } else {
      await startProcess(ffmpegPath, [...input, ...video, '-crf', String(PRESETS[job.settings.preset]), ...audio, ...output, job.output], { signal, onProgress: progress(0, 1) });
    }
    if (signal.aborted) throw new Error('Operation cancelled.');
    const [outputInfo, outputStat] = await Promise.all([inspectVideo(job.output, ffprobePath, signal), stat(job.output)]);
    if (outputStat.size >= job.outputLimit * 0.98 || outputInfo.duration < info.duration - Math.max(1, info.duration * 0.01)) throw new Error('The output would exceed the processing size limit. Try a smaller resolution or file.');
    job.width = outputInfo.width;
    job.height = outputInfo.height;
    job.outputBytes = outputStat.size;
    if (job.outputBytes >= job.inputBytes) job.warning = 'This video was already efficiently compressed. The new file is larger; keeping your original is recommended.';
    if (job.settings.targetMB && job.outputBytes > job.settings.targetMB * MB * 1.03) job.warning = 'The output exceeded the target size. Increase the target or lower the resolution; stricter compression may affect visible quality.';
    // Downloads only need the output. Remove the original and two-pass logs promptly.
    for (const entry of await readdir(job.directory)) if (entry !== 'output.mp4') await rm(join(job.directory, entry), { force: true });
    if (signal.aborted) throw new Error('Operation cancelled.');
    // Retain only the bytes still on disk. Completed jobs must not hold an encoding-size reservation.
    reservedBytes -= job.reservation - job.outputBytes;
    job.reservation = job.outputBytes;
    job.progress = 100;
    job.status = 'completed';
    job.finishedAt = Date.now();
  };

  const runQueue = () => {
    if (closing || activeJob) return;
    const job = [...jobs.values()].find((candidate) => candidate.status === 'queued');
    if (!job) return;
    activeJob = job;
    job.status = 'processing';
    // FFmpeg limits the output file itself; also bound auxiliary two-pass logs.
    const encodingBudget = job.reservation;
    let checkingDisk = false;
    const diskMonitor = setInterval(async () => {
      if (checkingDisk || job.controller.signal.aborted || job.status !== 'processing') return;
      checkingDisk = true;
      try {
        let bytes = 0;
        for (const name of await readdir(job.directory)) bytes += (await stat(join(job.directory, name))).size;
        if (bytes > encodingBudget && job.status === 'processing') {
          job.failureReason = 'The output exceeds this server’s temporary storage budget. Try a shorter video or a quality preset without a target size.';
          job.controller.abort();
        }
      } catch { /* Files may be removed by completion or cancellation. */ }
      finally { checkingDisk = false; }
    }, 1000);
    diskMonitor.unref();
    job.processingPromise = encode(job).catch(async (error) => {
      if (job.controller.signal.aborted && !job.failureReason) job.status = 'cancelled';
      else {
        job.status = 'failed';
        // Do not return FFmpeg stderr, temporary paths, or source metadata to the client.
        job.error = job.failureReason || (/^(That target|This file|This video|Videos longer|The output)/.test(error.message)
          ? error.message
          : 'This video could not be processed. Try an MP4, MOV, or WebM file that plays correctly.');
      }
      job.finishedAt = Date.now();
      await releaseFiles(job);
    }).finally(() => { clearInterval(diskMonitor); activeJob = null; runQueue(); });
  };

  const assertOrigin = (req) => {
    const host = req.headers.host;
    if (typeof host !== 'string' || !/^[a-zA-Z0-9.\-[\]:]+$/.test(host)) throw new HttpError(403, 'Invalid request host.');
    const origin = req.headers.origin;
    if (!origin) return;
    const allowed = publicOrigin ? [publicOrigin] : [`http://${host}`, `https://${host}`];
    if (allowDevOrigin) allowed.push('http://localhost:3000', 'http://127.0.0.1:3000');
    if (!allowed.includes(origin)) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  };

  const jobForRequest = (req, url, id, allowQuery = false) => {
    const job = jobs.get(id);
    const authorization = req.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : allowQuery ? url.searchParams.get('token') : null;
    if (!job || !validToken(token, job.token)) throw new HttpError(403, 'This job is unavailable or its access token is invalid.');
    return job;
  };

  const serveStatic = async (req, res, url) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path.'); }
    const filePath = resolve(buildDirectory, `.${pathname}`);
    if (filePath !== buildDirectory && !filePath.startsWith(buildDirectory + sep)) throw new HttpError(404, 'Not found.');
    let path = filePath;
    let info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      if (extname(pathname)) throw new HttpError(404, 'Not found.');
      path = join(buildDirectory, 'index.html');
      info = await stat(path).catch(() => null);
    }
    if (!info?.isFile()) throw new HttpError(404, 'Build the website first with npm run build, then start the server.');
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(path)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(path), res).catch(() => {});
  };

  const handleRequest = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      assertOrigin(req);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, { available, version, maxFileBytes, retentionMinutes: retentionMs / 60000, message: available ? undefined : 'Video compression is unavailable on this server. The operator needs to install FFmpeg and FFprobe.' });
      }
      if (url.pathname === '/api/jobs' && req.method === 'POST') {
        if (!available) throw new HttpError(503, 'Video processing is unavailable on this server.');
        if (closing) throw new HttpError(503, 'The server is restarting. Please try again shortly.');
        if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new HttpError(415, 'Send the video as an application/octet-stream body.');
        const length = req.headers['content-length'];
        if (!length || !/^\d+$/.test(length)) throw new HttpError(411, 'A known file size is required.');
        const inputBytes = Number(length);
        if (!Number.isSafeInteger(inputBytes) || inputBytes > maxFileBytes) throw new HttpError(413, 'This video exceeds the upload size limit.');
        if (inputBytes === 0) throw new HttpError(400, 'The video file is empty.');
        const settings = parseSettings(url);
        const outputLimit = Math.max(inputBytes * 2, 64 * MB);
        const reservation = inputBytes + outputLimit + 128 * MB;
        // Failed or cancelled records hold no files and must not crowd out new work.
        for (const [id, previous] of jobs) if (previous.released && ['failed', 'cancelled'].includes(previous.status)) jobs.delete(id);
        const pending = [...jobs.values()].filter((job) => ['uploading', 'queued', 'processing'].includes(job.status)).length;
        if (pending + pendingAdmissions >= maxPendingJobs || jobs.size + pendingAdmissions >= maxJobs || reservedBytes + reservation > maxDiskBytes) throw new HttpError(503, 'The video service is busy. Please try again after current jobs finish or expire.');
        // Reserve both count and storage before asynchronous allocation admits another request.
        pendingAdmissions += 1;
        reservedBytes += reservation;
        let directory;
        try { directory = await mkdtemp(join(tempRoot, 'job-')); } catch (error) { pendingAdmissions -= 1; reservedBytes -= reservation; throw error; }
        const job = { id: randomUUID(), token: randomBytes(32).toString('base64url'), settings, status: 'uploading', progress: 0, inputBytes, outputLimit, reservation, directory, input: join(directory, 'input'), output: join(directory, 'output.mp4'), controller: new AbortController(), createdAt: Date.now() };
        jobs.set(job.id, job);
        pendingAdmissions -= 1;
        const timer = setTimeout(() => job.controller.abort(), uploadTimeoutMs);
        timer.unref();
        let received = 0;
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          received += chunk.length;
          if (received > inputBytes || received > maxFileBytes) callback(new Error('Upload exceeded its declared length.'));
          else callback(null, chunk);
        } });
        const abortUpload = () => { if (!res.writableFinished) job.controller.abort(); };
        res.on('close', abortUpload);
        try {
          await pipeline(req, limiter, createWriteStream(job.input, { flags: 'wx', mode: 0o600 }), { signal: job.controller.signal });
          if (received !== inputBytes || job.controller.signal.aborted) throw new Error('Upload was interrupted.');
          job.status = 'queued';
          json(res, 202, { id: job.id, token: job.token });
          runQueue();
        } catch {
          job.controller.abort();
          await releaseFiles(job);
          jobs.delete(job.id);
          json(res, 400, { error: 'The upload was interrupted. Please try again.' });
        } finally { clearTimeout(timer); res.removeListener('close', abortUpload); }
        return;
      }
      const match = /^\/api\/jobs\/([a-f0-9-]+)(\/(?:download|preview))?$/.exec(url.pathname);
      if (match) {
        const download = Boolean(match[2]);
        const job = jobForRequest(req, url, match[1], download);
        if (download && req.method === 'GET') {
          if (job.status !== 'completed') throw new HttpError(409, 'This video is not ready to download.');
          job.downloads = (job.downloads || 0) + 1;
          const filename = job.settings.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
          let start = 0;
          let end = job.outputBytes - 1;
          const range = req.headers.range;
          if (range) {
            const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!parts || (!parts[1] && !parts[2])) { job.downloads -= 1; res.setHeader('Content-Range', `bytes */${job.outputBytes}`); throw new HttpError(416, 'Invalid byte range.'); }
            if (!parts[1]) start = Math.max(0, job.outputBytes - Number(parts[2]));
            else { start = Number(parts[1]); if (parts[2]) end = Math.min(end, Number(parts[2])); }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= job.outputBytes) { job.downloads -= 1; res.setHeader('Content-Range', `bytes */${job.outputBytes}`); throw new HttpError(416, 'Byte range is outside the file.'); }
          }
          const disposition = match[2] === '/preview' ? 'inline' : 'attachment';
          res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${job.outputBytes}` } : {}), 'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(job.settings.filename).replace(/'/g, '%27')}`, 'Cache-Control': 'no-store' });
          res.setTimeout(120_000, () => res.destroy());
          const stream = createReadStream(job.output, { start, end });
          job.downloadStreams ||= new Set();
          job.downloadStreams.add(stream);
          try { await pipeline(stream, res); } catch { /* The client may cancel a large download. */ }
          finally { job.downloadStreams.delete(stream); job.downloads -= 1; }
          return;
        }
        if (!download && req.method === 'GET') return json(res, 200, snapshot(job));
        if (!download && req.method === 'DELETE') {
          job.controller.abort();
          job.status = 'cancelled';
          job.finishedAt = Date.now();
          await job.processingPromise;
          await releaseFiles(job);
          return json(res, 200, snapshot(job));
        }
        throw new HttpError(405, 'Method not allowed.');
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      await serveStatic(req, res, url);
    } catch (error) {
      if (req.method === 'POST') { res.shouldKeepAlive = false; req.resume(); }
      json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
    }
  };
  const activeRequests = new Set();
  const server = createServer((req, res) => {
    const request = handleRequest(req, res);
    activeRequests.add(request);
    request.finally(() => activeRequests.delete(request));
  });
  server.requestTimeout = uploadTimeoutMs + 5000;
  server.headersTimeout = 30_000;
  server.maxHeadersCount = 50;

  const cleanupTimer = setInterval(() => {
    for (const [path, orphan] of orphanedDirectories) {
      if (Date.now() > orphan.expiresAt) {
        orphanedDirectories.delete(path);
        rm(path, { recursive: true, force: true }).then(() => { reservedBytes -= orphan.bytes; }).catch(() => { orphanedDirectories.set(path, orphan); });
      }
    }
    for (const [id, job] of jobs) {
      if (job.finishedAt && Date.now() - job.finishedAt > retentionMs && !job.downloads) {
        jobs.delete(id);
        releaseFiles(job).catch(() => {});
      }
    }
  }, options.cleanupIntervalMs || 60_000);
  cleanupTimer.unref();

  const close = async () => {
    closing = true;
    clearInterval(cleanupTimer);
    for (const job of jobs.values()) job.controller.abort();
    if (server.listening) await new Promise((resolveClose) => { server.close(resolveClose); server.closeAllConnections?.(); });
    // An upload may still be allocating its directory when shutdown begins.
    await Promise.allSettled([...activeRequests]);
    for (const job of jobs.values()) job.controller.abort();
    await Promise.allSettled([...jobs.values()].map(async (job) => { await job.processingPromise; await releaseFiles(job); }));
    jobs.clear();
  };
  return { server, close };
}
