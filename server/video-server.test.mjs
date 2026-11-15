import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVideoServer } from './video-server.mjs';

const run = promisify(execFile);
let fixtureDirectory;
let fixture;
let hasFFmpeg = true;

before(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'flexitools-test-fixture-'));
  try {
    await run('ffmpeg', ['-version']);
    await run('ffprobe', ['-version']);
  } catch {
    hasFFmpeg = false;
    return;
  }
  const path = join(fixtureDirectory, 'source.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ]);
  fixture = await readFile(path);
});

after(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

async function startServer(t, options = {}, prepareTempRoot = async () => {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'flexitools-test-server-'));
  await prepareTempRoot(tempRoot);
  const app = await createVideoServer({ tempRoot, allowDevOrigin: true, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
  });
  return { ...app, base, tempRoot };
}

async function upload(base, body = fixture, query = '', headers = {}) {
  return fetch(`${base}/api/jobs?filename=sample.mp4&preset=balanced&maxHeight=720${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body,
  });
}

function authorization(job) {
  return { authorization: `Bearer ${job.token}` };
}

async function pollJob(base, job, terminal = ['completed', 'failed', 'cancelled']) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/jobs/${job.id}`, { headers: authorization(job) });
    assert.equal(response.status, 200);
    const result = await response.json();
    if (terminal.includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('The video job did not finish within 30 seconds.');
}

test('health reports readiness and upload limits without exposing a shared capability', async t => {
  const { base } = await startServer(t);
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(typeof health.available, 'boolean');
  assert.ok(health.maxFileBytes > 0);
  assert.ok(health.retentionMinutes > 0);
  assert.equal(health.token, undefined);
});

test('a missing FFmpeg installation gives a usable unavailable status', async t => {
  const { base } = await startServer(t, {
    ffmpegPath: '/does-not-exist/flexitools-ffmpeg',
    ffprobePath: '/does-not-exist/flexitools-ffprobe',
  });
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.available, false);
  assert.ok(health.message);
});

test('rejects cross-origin requests without granting CORS access', async t => {
  const { base } = await startServer(t);
  const response = await upload(base, Buffer.from('test'), '', { origin: 'https://untrusted.example' });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('rejects invalid encoding options before accepting a file', async t => {
  const { base } = await startServer(t);
  for (const query of ['preset=unknown', 'maxHeight=99999', 'targetMB=-10']) {
    const response = await fetch(`${base}/api/jobs?filename=sample.mp4&${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('test'),
    });
    assert.equal(response.status, 400, query);
  }
});

test('rejects oversized uploads and exhausted disk reservations', async t => {
  const small = await startServer(t, { maxFileBytes: 3 });
  assert.equal((await upload(small.base, Buffer.from('four'))).status, 413);
  const full = await startServer(t, { maxDiskBytes: 1 });
  assert.equal((await upload(full.base, Buffer.from('video data'))).status, 503);
});

test('compresses a real video, keeps its audio and proportions, and serves an MP4 attachment', async t => {
  if (!hasFFmpeg) return t.skip('Native FFmpeg and FFprobe are required for the integration test.');
  const { base } = await startServer(t);
  const created = await upload(base);
  assert.equal(created.status, 202, await created.clone().text());
  const job = await created.json();
  assert.ok(job.id);
  assert.ok(job.token && job.token.length >= 32);
  const result = await pollJob(base, job);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.progress, 100);
  assert.equal(result.inputBytes, fixture.length);
  assert.ok(result.outputBytes > 0);
  assert.ok(result.outputBytes < result.inputBytes, 'A high-bitrate fixture should become smaller.');
  assert.equal(result.width, 640, 'A 720p maximum must not upscale a 360p input.');
  assert.equal(result.height, 360);

  const download = await fetch(`${base}/api/jobs/${job.id}/download?token=${encodeURIComponent(job.token)}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /video\/mp4/);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(download.headers.get('referrer-policy'), 'no-referrer');
  const output = Buffer.from(await download.arrayBuffer());
  assert.equal(output.length, result.outputBytes);
  const outputPath = join(fixtureDirectory, `output-${job.id}.mp4`);
  await writeFile(outputPath, output);
  const probe = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath]);
  const metadata = JSON.parse(probe.stdout);
  assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'), 'Audio must survive compression.');
  assert.ok(metadata.streams.some(stream => stream.codec_name === 'h264'));
  assert.ok(Math.abs(Number(metadata.format.duration) - 2) < 0.15);
});

test('each job capability protects status, cancellation, and downloads', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base } = await startServer(t);
  const first = await (await upload(base)).json();
  assert.equal((await pollJob(base, first)).status, 'completed');
  const second = await (await upload(base, Buffer.from('invalid-two'))).json();
  assert.ok(first.token && second.token);
  assert.notEqual(first.token, second.token);
  for (const headers of [{}, { authorization: 'Bearer invalid' }, authorization(second)]) {
    assert.equal((await fetch(`${base}/api/jobs/${first.id}`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/jobs/${first.id}`, { method: 'DELETE', headers })).status, 403);
  }
  assert.equal((await fetch(`${base}/api/jobs/${first.id}/download?token=${second.token}`)).status, 403);
  assert.equal((await fetch(`${base}/api/jobs/${first.id}/preview?token=${second.token}`)).status, 403);
  const own = await fetch(`${base}/api/jobs/${first.id}`, { headers: authorization(first) });
  assert.equal(own.status, 200);
});

test('a Unicode filename at the truncation boundary remains downloadable', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to produce the downloadable video.');
  const { base } = await startServer(t);
  const filename = `${'a'.repeat(99)}😀.mp4`;
  const response = await fetch(`${base}/api/jobs?filename=${encodeURIComponent(filename)}&preset=balanced`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: fixture,
  });
  assert.equal(response.status, 202);
  const job = await response.json();
  const result = await pollJob(base, job);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.filename, `${'a'.repeat(99)}😀-compressed.mp4`);
  const download = await fetch(`${base}/api/jobs/${job.id}/download?token=${job.token}`);
  assert.equal(download.status, 200);
  assert.ok(download.headers.get('content-disposition').includes(`filename*=UTF-8''${encodeURIComponent(result.filename)}`));
  assert.equal((await download.arrayBuffer()).byteLength, result.outputBytes);
});

test('invalid video bytes fail cleanly instead of yielding a fake successful download', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to validate uploaded video bytes.');
  const { base } = await startServer(t);
  const created = await upload(base, Buffer.from('this is not a video'));
  assert.equal(created.status, 202);
  const job = await created.json();
  const result = await pollJob(base, job);
  assert.equal(result.status, 'failed');
  assert.ok(result.error);
  const download = await fetch(`${base}/api/jobs/${job.id}/download?token=${job.token}`);
  assert.notEqual(download.status, 200);
});

test('cancellation removes the output and stops further downloads', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base } = await startServer(t);
  const created = await upload(base);
  assert.equal(created.status, 202);
  const job = await created.json();
  const cancelled = await fetch(`${base}/api/jobs/${job.id}`, { method: 'DELETE', headers: authorization(job) });
  assert.ok(cancelled.ok);
  const status = await fetch(`${base}/api/jobs/${job.id}`, { headers: authorization(job) });
  if (status.status === 200) assert.equal((await status.json()).status, 'cancelled');
  else assert.equal(status.status, 404);
  const download = await fetch(`${base}/api/jobs/${job.id}/download?token=${job.token}`);
  assert.notEqual(download.status, 200);
});

test('expired jobs can no longer be downloaded', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base } = await startServer(t, { retentionMs: 500, cleanupIntervalMs: 25 });
  const created = await upload(base, Buffer.from('invalid expired video'));
  assert.equal(created.status, 202);
  const job = await created.json();
  await pollJob(base, job);
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal((await fetch(`${base}/api/jobs/${job.id}`, { headers: authorization(job) })).status, 403);
});

test('target size uses a real completed encode and explains its approximate quality tradeoff', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required for target-size encoding.');
  const { base } = await startServer(t);
  const created = await upload(base, fixture, '&targetMB=1');
  assert.equal(created.status, 202);
  const job = await created.json();
  const result = await pollJob(base, job);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.progress, 100);
  assert.ok(result.outputBytes > 0);
  assert.ok(result.warning, 'The result must explain target-size or already-compressed limitations.');
});

test('downscales a silent video proportionally without requiring an audio stream', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required for resolution changes.');
  const silentPath = join(fixtureDirectory, 'silent-landscape.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=1280x800:rate=12', '-t', '0.5',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', silentPath,
  ]);
  const { base } = await startServer(t);
  const created = await upload(base, await readFile(silentPath));
  assert.equal(created.status, 202);
  const job = await created.json();
  const result = await pollJob(base, job);
  assert.equal(result.status, 'completed', result.error);
  assert.equal(result.width, 1152);
  assert.equal(result.height, 720);
});

test('uploaded playlists cannot make FFmpeg fetch another HTTP service', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to verify input protocol restrictions.');
  let requests = 0;
  const trap = createHttpServer((_request, response) => {
    requests += 1;
    response.writeHead(404).end();
  });
  trap.listen(0, '127.0.0.1');
  await once(trap, 'listening');
  t.after(() => new Promise(resolve => trap.close(resolve)));
  const { base } = await startServer(t);
  const playlist = Buffer.from(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${trap.address().port}/private.ts\n#EXT-X-ENDLIST\n`);
  const created = await upload(base, playlist);
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.equal((await pollJob(base, job)).status, 'failed');
  assert.equal(requests, 0, 'Untrusted input must not be allowed to request network resources.');
});

test('an interrupted upload releases its admission slot for the next file', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base } = await startServer(t, { maxJobs: 1 });
  await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/jobs?filename=interrupted.mp4&preset=balanced&maxHeight=0`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': fixture.length + 1000 },
    });
    request.on('error', error => {
      if (error.code === 'ECONNRESET') resolve();
      else reject(error);
    });
    request.write(fixture.subarray(0, 1000));
    setTimeout(() => { request.destroy(); resolve(); }, 150);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const created = await upload(base);
  assert.equal(created.status, 202, 'An aborted request must not retain the only job slot.');
  const job = await created.json();
  assert.equal((await pollJob(base, job)).status, 'completed');
});

test('inline previews and attachments support accurate seekable byte ranges', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to create a preview.');
  const { base } = await startServer(t);
  const created = await upload(base);
  assert.equal(created.status, 202);
  const job = await created.json();
  const result = await pollJob(base, job);
  assert.equal(result.status, 'completed', result.error);
  const previewUrl = `${base}/api/jobs/${job.id}/preview?token=${job.token}`;
  const complete = await fetch(previewUrl);
  assert.equal(complete.status, 200);
  assert.match(complete.headers.get('content-disposition'), /^inline;/);
  assert.equal(complete.headers.get('accept-ranges'), 'bytes');
  assert.match(complete.headers.get('content-type'), /video\/mp4/);
  const completeBytes = Buffer.from(await complete.arrayBuffer());
  assert.equal(completeBytes.length, result.outputBytes);

  const ranges = [
    { value: 'bytes=4-39', start: 4, end: 39 },
    { value: 'bytes=-37', start: completeBytes.length - 37, end: completeBytes.length - 1 },
    { value: `bytes=${completeBytes.length - 40}-`, start: completeBytes.length - 40, end: completeBytes.length - 1 },
    { value: `bytes=${completeBytes.length - 20}-999999999`, start: completeBytes.length - 20, end: completeBytes.length - 1 },
  ];
  for (const endpoint of ['preview', 'download']) {
    for (const range of ranges) {
      const response = await fetch(`${base}/api/jobs/${job.id}/${endpoint}?token=${job.token}`, {
        headers: { range: range.value },
      });
      assert.equal(response.status, 206, `${endpoint}: ${range.value}`);
      assert.equal(response.headers.get('content-range'), `bytes ${range.start}-${range.end}/${completeBytes.length}`);
      assert.equal(Number(response.headers.get('content-length')), range.end - range.start + 1);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), completeBytes.subarray(range.start, range.end + 1));
      assert.match(response.headers.get('content-disposition'), endpoint === 'preview' ? /^inline;/ : /^attachment;/);
    }
  }
  for (const value of ['garbage', 'bytes=-0', 'bytes=20-10', 'bytes=0-1,5-6', `bytes=${completeBytes.length}-`]) {
    const response = await fetch(previewUrl, { headers: { range: value } });
    assert.equal(response.status, 416, value);
    assert.equal(response.headers.get('content-range'), `bytes */${completeBytes.length}`);
  }
});

test('released failed and cancelled jobs do not keep the only admission slot', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base } = await startServer(t, { maxJobs: 1 });
  const firstResponse = await upload(base, Buffer.from('invalid video'));
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  assert.equal((await pollJob(base, first)).status, 'failed');

  const secondResponse = await upload(base);
  assert.equal(secondResponse.status, 202, 'A failed job must not retain the only slot.');
  const second = await secondResponse.json();
  assert.equal((await fetch(`${base}/api/jobs/${second.id}`, { method: 'DELETE', headers: authorization(second) })).status, 200);

  const thirdResponse = await upload(base);
  assert.equal(thirdResponse.status, 202, 'A deleted job must not retain the only slot.');
  const third = await thirdResponse.json();
  assert.equal((await pollJob(base, third)).status, 'completed');
});

async function sparseFile(path, bytes) {
  const file = await open(path, 'w');
  try { await file.truncate(bytes); } finally { await file.close(); }
}

test('unexpired restart leftovers count toward disk admission until their retention expires', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base, tempRoot } = await startServer(t, {
    maxDiskBytes: 256 * 1024 * 1024,
    retentionMs: 500,
    cleanupIntervalMs: 25,
  }, async root => {
    const orphan = join(root, 'job-unexpired');
    await mkdir(orphan);
    await sparseFile(join(orphan, 'input'), 256 * 1024 * 1024);
  });
  assert.equal((await upload(base, Buffer.from('video'))).status, 503, 'Leftovers must be included before any new upload is admitted.');
  await new Promise(resolve => setTimeout(resolve, 650));
  await assert.rejects(stat(join(tempRoot, 'job-unexpired')), { code: 'ENOENT' });
  assert.equal((await upload(base, Buffer.from('video'))).status, 202, 'Expired leftovers must release their disk reservation.');
});

test('startup removes expired job leftovers while preserving unrelated directories', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base, tempRoot } = await startServer(t, {
    maxDiskBytes: 256 * 1024 * 1024,
    retentionMs: 1000,
  }, async root => {
    const orphan = join(root, 'job-expired');
    await mkdir(orphan);
    await sparseFile(join(orphan, 'output.mp4'), 300 * 1024 * 1024);
    const old = new Date(Date.now() - 60_000);
    await utimes(orphan, old, old);
    await mkdir(join(root, 'unrelated'));
    await writeFile(join(root, 'unrelated', 'keep.txt'), 'keep');
  });
  await assert.rejects(stat(join(tempRoot, 'job-expired')), { code: 'ENOENT' });
  assert.equal(await readFile(join(tempRoot, 'unrelated', 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await upload(base, Buffer.from('video'))).status, 202);
});

function holdUploads(base, count) {
  const responses = [];
  const errors = [];
  const requests = [];
  // Open every request in one turn so admission checks overlap while creating
  // their temporary directory. Keep each admitted upload unfinished.
  for (let index = 0; index < count; index += 1) {
    const request = httpRequest(`${base}/api/jobs?filename=held.mp4`, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/octet-stream', 'content-length': '10000' },
    }, response => {
      responses.push(response.statusCode);
      response.resume();
    });
    request.on('error', error => {
      if (error.code !== 'ECONNRESET') errors.push(error);
    });
    requests.push(request);
    request.flushHeaders();
    request.write('x');
  }
  return { responses, errors, destroy: () => requests.forEach(request => request.destroy()) };
}

async function waitForAdmission(tempRoot, uploads, expectedRejections) {
  const deadline = Date.now() + 2000;
  let directories = [];
  while (Date.now() < deadline) {
    directories = (await readdir(tempRoot)).filter(name => name.startsWith('job-'));
    if (directories.length > 1 || (directories.length === 1 && uploads.responses.length === expectedRejections)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(directories.length, 1, 'Only one upload may create temporary files.');
  assert.deepEqual(uploads.errors, []);
  assert.equal(uploads.responses.length, expectedRejections, 'Every request beyond the limit must receive a response.');
  assert.ok(uploads.responses.every(status => status === 503), 'Requests beyond the limit must be rejected as busy.');
}

async function waitForEmptyJobDirectory(tempRoot) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!(await readdir(tempRoot)).some(name => name.startsWith('job-'))) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Interrupted uploads did not release their temporary files.');
}

test('simultaneous uploads reserve the single admission slot before filesystem work', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base, tempRoot } = await startServer(t, {
    maxPendingJobs: 1,
    maxJobs: 1,
    maxDiskBytes: 2 * 1024 * 1024 * 1024,
  });
  const uploads = holdUploads(base, 8);
  try {
    await waitForAdmission(tempRoot, uploads, 7);
  } finally {
    uploads.destroy();
  }
  await waitForEmptyJobDirectory(tempRoot);
  const next = await upload(base);
  assert.equal(next.status, 202, 'Aborting the admitted upload must release the slot.');
  assert.equal((await pollJob(base, await next.json())).status, 'completed');
});

test('concurrent deletion releases a disk reservation exactly once', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const { base, tempRoot } = await startServer(t, { maxDiskBytes: 256 * 1024 * 1024 });
  const created = await upload(base);
  assert.equal(created.status, 202);
  const job = await created.json();
  // Cancel during processing, while the full input/output reservation is held.
  const deletions = await Promise.all([1, 2].map(() => fetch(`${base}/api/jobs/${job.id}`, {
    method: 'DELETE', headers: authorization(job),
  })));
  assert.ok(deletions.every(response => response.status === 200));
  await waitForEmptyJobDirectory(tempRoot);
  const uploads = holdUploads(base, 2);
  try {
    // The remaining budget fits one upload. Releasing the prior reservation
    // twice would incorrectly admit both of these held requests.
    await waitForAdmission(tempRoot, uploads, 1);
  } finally {
    uploads.destroy();
  }
});

test('completed jobs retain only their output bytes in the disk budget', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to reconcile completed video storage.');
  const { base } = await startServer(t, { maxDiskBytes: 256 * 1024 * 1024 });
  const firstResponse = await upload(base);
  assert.equal(firstResponse.status, 202);
  const first = await firstResponse.json();
  const firstResult = await pollJob(base, first);
  assert.equal(firstResult.status, 'completed', firstResult.error);

  const secondResponse = await upload(base);
  assert.equal(secondResponse.status, 202, 'An old input and encoding reserve must not remain charged after successful cleanup.');
  const second = await secondResponse.json();
  assert.equal((await pollJob(base, second)).status, 'completed');

  const retainedDownload = await fetch(`${base}/api/jobs/${first.id}/download?token=${first.token}`);
  assert.equal(retainedDownload.status, 200, 'The first output must remain available while the next job runs.');
  assert.equal((await retainedDownload.arrayBuffer()).byteLength, firstResult.outputBytes);
});

test('shutdown waits for an unfinished upload to abort and remove its temporary files', async t => {
  if (!hasFFmpeg) return t.skip('FFmpeg is required to admit video jobs.');
  const app = await startServer(t);
  const uploads = holdUploads(app.base, 1);
  let timeout;
  try {
    await waitForAdmission(app.tempRoot, uploads, 0);
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Shutdown did not finish while an upload was held open.')), 2000);
      }),
    ]);
    assert.equal(app.server.listening, false);
    assert.deepEqual(
      (await readdir(app.tempRoot)).filter(name => name.startsWith('job-')),
      [],
      'Shutdown must finish upload cleanup before resolving.',
    );
  } finally {
    clearTimeout(timeout);
    uploads.destroy();
  }
});
