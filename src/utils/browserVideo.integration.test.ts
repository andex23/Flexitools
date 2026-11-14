/** @jest-environment node */
import { ReadableStream, WritableStream } from 'stream/web';
import { convertBrowserVideo, inspectBrowserVideo } from './browserVideo';

// Real Mediabunny demux/decode/convert/mux, without a mocked conversion engine.
// PCM WAV exercises portable processing; WebCodecs video still needs a browser smoke check.
const nodeBuffer = require('buffer');
const originalApis: Record<string, unknown> = {};
beforeAll(() => {
  const replacements = { Blob: nodeBuffer.Blob, File: nodeBuffer.File, ReadableStream, WritableStream };
  const globals = globalThis as unknown as Record<string, unknown>;
  Object.entries(replacements).forEach(([key, value]) => {
    originalApis[key] = globals[key];
    globals[key] = value;
  });
});
afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  Object.entries(originalApis).forEach(([key, value]) => { globals[key] = value; });
});

function tone(): File {
  const samples = 48000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(Math.sin(i / 48000 * 440 * 2 * Math.PI) * 8192), 44 + i * 2);
  }
  return new File([wav], 'tone.wav', { type: 'audio/wav' });
}

it('extracts an actual half-second WAV whose muxed duration and sample data survive a round trip', async () => {
  const input = tone();
  expect(await inspectBrowserVideo(input)).toEqual({ duration: 1, width: 0, height: 0, hasAudio: true });
  const result = await convertBrowserVideo(input, {
    operation: 'audio', format: 'wav', preset: 'quality', maxHeight: 0, trimStart: 0.25, trimEnd: 0.75, mute: false,
  });
  const outputFile = new File([result.blob!], result.filename, { type: result.mimeType });
  const outputMetadata = await inspectBrowserVideo(outputFile);
  expect(outputMetadata.duration).toBeCloseTo(0.5, 5);
  expect(result.outputBytes).toBe(44 + 24000 * 2 * 2); // header + stereo s16 at 48 kHz
  const pcm = new DataView(await result.blob!.arrayBuffer());
  expect(pcm.getInt16(44 + 240, true)).not.toBe(0);
});

it('writes an identical real WAV to a direct disk sink with header rewrites and no output Blob', async () => {
  const settings = {
    operation: 'audio' as const, format: 'wav' as const, preset: 'quality' as const,
    maxHeight: 0, trimStart: 0.25, trimEnd: 0.75, mute: false,
  };
  const memory = await convertBrowserVideo(tone(), settings);
  const diskData = new Uint8Array(memory.outputBytes);
  const disk = {
    write: jest.fn(async ({ position, data }: { position: number; data: Uint8Array }) => { diskData.set(data, position); }),
    close: jest.fn(async () => undefined), abort: jest.fn(async () => undefined),
  };
  const result = await convertBrowserVideo(tone(), settings, { saveToDisk: disk });
  expect(result.savedToDisk).toBe(true);
  expect(result.blob).toBeUndefined();
  expect(disk.close).toHaveBeenCalledTimes(1);
  expect(disk.abort).not.toHaveBeenCalled();
  expect(diskData).toEqual(new Uint8Array(await memory.blob!.arrayBuffer()));
});
