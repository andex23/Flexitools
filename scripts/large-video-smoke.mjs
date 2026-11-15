import { createVideoServer } from '../server/video-server.mjs';
import { open, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { pipeline } from 'node:stream/promises';
const dir = await mkdtemp(join(tmpdir(), 'flexi-large-proof-'));
let app;
let timer;
try {
  const input = join(dir, 'large.mp4');
  const source = join(dir, 'source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-crf',
    '8',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    source,
  ]);
  const sample = await readFile(source);
  const freeBytes = 2 * 1024 ** 3 + 1024;
  const handle = await open(input, 'w');
  await handle.write(sample);
  const box = Buffer.alloc(8);
  box.writeUInt32BE(freeBytes);
  box.write('free', 4);
  await handle.write(box);
  await handle.truncate(sample.length + freeBytes);
  await handle.close();
  app = await createVideoServer({
    tempRoot: join(dir, 'server'),
    maxFileBytes: 3 * 1024 ** 3,
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let maxRSS = process.memoryUsage().rss;
  timer = setInterval(() => {
    maxRSS = Math.max(maxRSS, process.memoryUsage().rss);
  }, 25);
  const start = Date.now();
  const identity = await new Promise((resolve, reject) => {
    const upload = request(
      `${base}/api/jobs?filename=large-smoke.mp4&preset=quality&maxHeight=0`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(sample.length + freeBytes),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 202) reject(new Error(body));
          else resolve(JSON.parse(body));
        });
      },
    );
    upload.on('error', reject);
    pipeline(createReadStream(input), upload).catch(reject);
  });
  let status;
  for (let i = 0; i < 120; i++) {
    status = await (
      await fetch(`${base}/api/jobs/${identity.id}`, {
        headers: { Authorization: `Bearer ${identity.token}` },
      })
    ).json();
    if (['completed', 'failed'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (status.status !== 'completed') throw new Error(JSON.stringify(status));
  const download = await fetch(
    `${base}/api/jobs/${identity.id}/download?token=${identity.token}`,
  );
  const output = await download.arrayBuffer();

  console.log(
    JSON.stringify(
      {
        test: '2 GiB plus valid MP4 free-box streaming smoke (padding tests transport, not compression quality)',
        inputBytes: sample.length + freeBytes,
        outputBytes: output.byteLength,
        status: status.status,
        width: status.width,
        height: status.height,
        duration: status.duration,
        elapsedSeconds: (Date.now() - start) / 1000,
        maxNodeRSSMiB: Math.round(maxRSS / 1024 ** 2),
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await app?.close();
  await rm(dir, { recursive: true, force: true });
}
