import { WritableStream as NodeWritableStream } from 'stream/web';
import { BlobSource, Conversion, Input, Output, StreamTarget, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import {
  BROWSER_VIDEO_DISK_INPUT_LIMIT, BROWSER_VIDEO_INPUT_LIMIT, BROWSER_VIDEO_OUTPUT_LIMIT,
  convertBrowserVideo, fitBrowserVideoDimensions, getBrowserVideoCapabilities, inspectBrowserVideo,
} from './browserVideo';
import type { BrowserVideoSettings, BrowserVideoWritable } from './browserVideo';

let mockVideo: Record<string, jest.Mock> | null;
let mockAudio: Record<string, jest.Mock> | null;
let mockInput: Record<string, jest.Mock>;
let mockConversion: { isValid: boolean; discardedTracks: { reason: string }[]; execute: jest.Mock; cancel: jest.Mock; onProgress?: (progress: number) => void };
let mockTarget: { stream: WritableStream; listener?: (event: { end: number }) => void };
let mockOutput: { cancel: jest.Mock };

jest.mock('mediabunny', () => ({
  ALL_FORMATS: [], QUALITY_HIGH: { quality: 'high' }, QUALITY_MEDIUM: { quality: 'medium' }, QUALITY_LOW: { quality: 'low' },
  BlobSource: jest.fn().mockImplementation(file => ({ file })),
  Input: jest.fn().mockImplementation(() => mockInput),
  Conversion: { init: jest.fn(async () => mockConversion) },
  Output: jest.fn().mockImplementation(() => mockOutput),
  StreamTarget: jest.fn().mockImplementation(stream => {
    mockTarget = { stream };
    return { on: (_event: string, listener: (event: { end: number }) => void) => { mockTarget.listener = listener; } };
  }),
  Mp4OutputFormat: jest.fn(), WebMOutputFormat: jest.fn(), OggOutputFormat: jest.fn(), WavOutputFormat: jest.fn(),
  canEncodeVideo: jest.fn(async () => true), canEncodeAudio: jest.fn(async () => true),
}));

const defaults: BrowserVideoSettings = {
  operation: 'video', format: 'mp4', preset: 'balanced', maxHeight: 1080,
  trimStart: 0, mute: false,
};
const media = () => new File([new Uint8Array(32)], 'holiday.mov', { type: 'video/quicktime' });
const writable = (): BrowserVideoWritable => ({
  write: jest.fn(async () => undefined), close: jest.fn(async () => undefined), abort: jest.fn(async () => undefined),
});
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
async function emitChunk(position: number, data: number[]) {
  mockTarget.listener?.({ end: position + data.length });
  const writer = mockTarget.stream.getWriter();
  await writer.write({ type: 'write', position, data: new Uint8Array(data) });
  writer.releaseLock();
}

beforeEach(() => {
  jest.clearAllMocks();
  (BlobSource as jest.Mock).mockImplementation(file => ({ file }));
  (Input as jest.Mock).mockImplementation(() => mockInput);
  (Output as jest.Mock).mockImplementation(() => mockOutput);
  (StreamTarget as jest.Mock).mockImplementation(stream => {
    mockTarget = { stream };
    return { on: (_event: string, listener: (event: { end: number }) => void) => { mockTarget.listener = listener; } };
  });
  (canEncodeVideo as jest.Mock).mockResolvedValue(true);
  (canEncodeAudio as jest.Mock).mockResolvedValue(true);
  Object.defineProperty(globalThis, 'WritableStream', { configurable: true, writable: true, value: NodeWritableStream });
  Object.defineProperty(globalThis, 'VideoDecoder', { configurable: true, writable: true, value: function VideoDecoder() {} });
  Object.defineProperty(globalThis, 'AudioDecoder', { configurable: true, writable: true, value: function AudioDecoder() {} });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, writable: true, value: true });
  mockVideo = {
    getDisplayWidth: jest.fn(async () => 3840), getDisplayHeight: jest.fn(async () => 2160),
    canDecode: jest.fn(async () => true), hasHighDynamicRange: jest.fn(async () => false),
  };
  mockAudio = { canDecode: jest.fn(async () => true) };
  mockInput = {
    canRead: jest.fn(async () => true), getPrimaryVideoTrack: jest.fn(async () => mockVideo),
    getPrimaryAudioTrack: jest.fn(async () => mockAudio), computeDuration: jest.fn(async () => 60), dispose: jest.fn(),
  };
  mockOutput = { cancel: jest.fn(async () => undefined) };
  mockConversion = {
    isValid: true, discardedTracks: [], cancel: jest.fn(async () => undefined),
    execute: jest.fn(async () => {
      mockConversion.onProgress?.(0.5);
      await emitChunk(0, [1, 2, 3, 4]);
      await emitChunk(2, [5, 6]);
      const writer = mockTarget.stream.getWriter();
      await writer.close();
    }),
  };
  (Conversion.init as jest.Mock).mockImplementation(async () => mockConversion);
});

describe('browser codec availability', () => {
  it('offers only formats whose encoders are available, while retaining WAV audio extraction', async () => {
    (canEncodeVideo as jest.Mock).mockImplementation(async codec => codec === 'vp9');
    (canEncodeAudio as jest.Mock).mockImplementation(async codec => codec === 'opus');
    await expect(getBrowserVideoCapabilities()).resolves.toMatchObject({
      supported: true, videoFormats: ['webm'], audioFormats: ['ogg', 'wav'],
    });
  });

  it('reports a missing secure context or browser decoders without starting a conversion', async () => {
    Object.defineProperty(globalThis, 'isSecureContext', { value: false });
    await expect(getBrowserVideoCapabilities()).resolves.toMatchObject({ supported: false, reason: expect.stringContaining('HTTPS') });
    Object.defineProperty(globalThis, 'isSecureContext', { value: true });
    Object.defineProperty(globalThis, 'VideoDecoder', { value: undefined });
    Object.defineProperty(globalThis, 'AudioDecoder', { value: undefined });
    await expect(getBrowserVideoCapabilities()).resolves.toMatchObject({ supported: false, videoFormats: [], audioFormats: [] });
    expect(Conversion.init).not.toHaveBeenCalled();
  });
});

describe('metadata and proportional resizing', () => {
  it('reads file ranges through BlobSource and always disposes the metadata input', async () => {
    const file = media();
    await expect(inspectBrowserVideo(file)).resolves.toEqual({ duration: 60, width: 3840, height: 2160, hasAudio: true });
    expect(BlobSource).toHaveBeenCalledWith(file, { maxCacheSize: 8 * 1024 ** 2 });
    expect(mockInput.dispose).toHaveBeenCalledTimes(1);
  });

  it('never upscales and rounds to encodable even dimensions', () => {
    expect(fitBrowserVideoDimensions(3840, 2160, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitBrowserVideoDimensions(640, 480, 1080)).toEqual({ width: 640, height: 480 });
    expect(fitBrowserVideoDimensions(1921, 1081, 0)).toEqual({ width: 1920, height: 1080 });
    expect(fitBrowserVideoDimensions(1080, 1920, 720)).toEqual({ width: 404, height: 720 });
    expect(() => fitBrowserVideoDimensions(1920, 1080, NaN)).toThrow('valid maximum');
    expect(() => fitBrowserVideoDimensions(1920, 1080, 1)).toThrow('too small');
  });

  it('rejects damaged files, extreme frame sizes, and excessively long duration before allocating output', async () => {
    mockInput.canRead.mockResolvedValueOnce(false);
    await expect(inspectBrowserVideo(media())).rejects.toThrow('not supported');
    mockVideo!.getDisplayWidth.mockResolvedValueOnce(12000);
    mockVideo!.getDisplayHeight.mockResolvedValueOnce(12000);
    await expect(inspectBrowserVideo(media())).rejects.toThrow('40 megapixels');
    mockInput.computeDuration.mockResolvedValueOnce(24 * 60 * 60 + 1);
    await expect(inspectBrowserVideo(media())).rejects.toThrow('24 hours');
    expect(Output).not.toHaveBeenCalled();
    expect(mockInput.dispose).toHaveBeenCalledTimes(3);
  });
});

describe('browser-only media conversion', () => {
  it('forces a precise trimmed re-encode and returns seek-safe bounded output with complete progress', async () => {
    const progress = jest.fn();
    const result = await convertBrowserVideo(media(), { ...defaults, trimStart: 5, trimEnd: 15 }, { onProgress: progress });
    expect(Conversion.init).toHaveBeenCalledWith(expect.objectContaining({
      tracks: 'primary', trim: { start: 5, end: 15 }, copy: false, tags: {},
      video: expect.objectContaining({ width: 1920, height: 1080, codec: 'avc', forceTranscode: true }),
      audio: expect.objectContaining({ codec: 'aac', forceTranscode: true }),
    }));
    expect(result).toMatchObject({ duration: 10, outputBytes: 4, savedToDisk: false, filename: 'holiday-compressed.mp4', mimeType: 'video/mp4' });
    expect(Array.from(await readBlob(result.blob!))).toEqual([1, 2, 5, 6]);
    expect(progress.mock.calls.map(call => call[0])).toEqual([0, 0.5, 1]);
    expect(mockInput.dispose).toHaveBeenCalledTimes(1);
  });

  it('supports mute and audio-only extraction without unnecessarily decoding discarded tracks', async () => {
    mockAudio!.canDecode.mockResolvedValue(false);
    await convertBrowserVideo(media(), { ...defaults, mute: true });
    expect(mockAudio!.canDecode).not.toHaveBeenCalled();
    expect(Conversion.init).toHaveBeenLastCalledWith(expect.objectContaining({ audio: { discard: true } }));
    mockAudio!.canDecode.mockResolvedValue(true);
    mockVideo!.canDecode.mockClear();
    mockVideo!.hasHighDynamicRange.mockResolvedValue(true);
    const result = await convertBrowserVideo(media(), { ...defaults, operation: 'audio', format: 'wav' });
    expect(Conversion.init).toHaveBeenLastCalledWith(expect.objectContaining({ video: { discard: true }, audio: expect.objectContaining({ codec: 'pcm-s16' }) }));
    expect(mockVideo!.canDecode).not.toHaveBeenCalled();
    expect(result.filename).toBe('holiday-audio.wav');
    expect(result.warning).toContain('WAV is uncompressed');
  });

  it('does not silently export HDR with changed colors, missing audio, or a failed codec', async () => {
    mockVideo!.hasHighDynamicRange.mockResolvedValueOnce(true);
    await expect(convertBrowserVideo(media(), defaults)).rejects.toThrow('HDR video');
    (canEncodeAudio as jest.Mock).mockResolvedValueOnce(false);
    await expect(convertBrowserVideo(media(), defaults)).rejects.toThrow('cannot encode AAC');
    mockAudio = null;
    await expect(convertBrowserVideo(media(), { ...defaults, operation: 'audio', format: 'ogg' })).rejects.toThrow('no audio');
    expect(Conversion.init).not.toHaveBeenCalled();
  });

  it('refuses a nominally valid conversion that has silently discarded a requested track', async () => {
    mockConversion.discardedTracks = [{ reason: 'undecodable_source_codec' }];
    await expect(convertBrowserVideo(media(), defaults)).rejects.toThrow('all requested media tracks');
    expect(mockConversion.execute).not.toHaveBeenCalled();
    expect(mockConversion.cancel).toHaveBeenCalled();
  });

  it.each([
    { trimStart: -1 }, { trimStart: 10, trimEnd: 5 }, { trimStart: 0, trimEnd: 61 },
    { trimStart: NaN }, { trimEnd: Infinity }, { format: 'wav' },
  ])('rejects invalid settings before output allocation: %p', async change => {
    await expect(convertBrowserVideo(media(), { ...defaults, ...change } as BrowserVideoSettings)).rejects.toThrow();
    expect(Output).not.toHaveBeenCalled();
  });
});

describe('bounded downloads and direct disk writes', () => {
  it('rejects oversized inputs before reading and permits the larger direct disk path', async () => {
    const file = media();
    Object.defineProperty(file, 'size', { value: BROWSER_VIDEO_INPUT_LIMIT + 1, configurable: true });
    await expect(convertBrowserVideo(file, defaults)).rejects.toThrow('500 MiB');
    expect(Input).not.toHaveBeenCalled();
    const disk = writable();
    const result = await convertBrowserVideo(file, defaults, { saveToDisk: disk });
    expect(result).toMatchObject({ savedToDisk: true, blob: undefined, outputBytes: 4 });
    expect(disk.write).toHaveBeenCalledTimes(2);
    expect(disk.close).toHaveBeenCalledTimes(1);
    expect(disk.abort).not.toHaveBeenCalled();
    Object.defineProperty(file, 'size', { value: BROWSER_VIDEO_DISK_INPUT_LIMIT + 1 });
    const largeDisk = writable();
    await expect(convertBrowserVideo(file, defaults, { saveToDisk: largeDisk })).rejects.toThrow('4 GiB');
    expect(largeDisk.abort).toHaveBeenCalledTimes(1);
  });

  it('stops oversized output before a chunk is buffered', async () => {
    mockConversion.execute.mockImplementationOnce(async () => {
      mockTarget.listener?.({ end: BROWSER_VIDEO_OUTPUT_LIMIT + 1 });
    });
    await expect(convertBrowserVideo(media(), defaults)).rejects.toThrow('256 MiB');
    expect(mockConversion.cancel).toHaveBeenCalledTimes(1);
    expect(mockInput.dispose).toHaveBeenCalledTimes(1);
  });

  it('aborts the disk file if initialization or a disk write fails, without closing it', async () => {
    const disk = writable();
    (Conversion.init as jest.Mock).mockRejectedValueOnce(new Error('Initialization failed'));
    await expect(convertBrowserVideo(media(), defaults, { saveToDisk: disk })).rejects.toThrow('Initialization failed');
    expect(mockOutput.cancel).toHaveBeenCalledTimes(1);
    expect(disk.close).not.toHaveBeenCalled();
    expect(disk.abort).toHaveBeenCalledTimes(1);
    const fullDisk = writable();
    (fullDisk.write as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));
    await expect(convertBrowserVideo(media(), defaults, { saveToDisk: fullDisk })).rejects.toThrow('Disk full');
    expect(fullDisk.close).not.toHaveBeenCalled();
    expect(fullDisk.abort).toHaveBeenCalledTimes(1);
  });
});

describe('cancellation and cleanup', () => {
  it('does not read an input when already aborted and aborts an opened disk destination', async () => {
    const controller = new AbortController();
    controller.abort();
    const disk = writable();
    await expect(convertBrowserVideo(media(), defaults, { signal: controller.signal, saveToDisk: disk })).rejects.toMatchObject({ name: 'AbortError' });
    expect(Input).not.toHaveBeenCalled();
    expect(disk.abort).toHaveBeenCalledTimes(1);
  });

  it('disposes metadata inspection when canceled during a read', async () => {
    const controller = new AbortController();
    mockInput.computeDuration.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Input disposed');
    });
    await expect(inspectBrowserVideo(media(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockInput.dispose).toHaveBeenCalled();
  });

  it('cancels the encoder and aborts, rather than commits, an incomplete disk export', async () => {
    const controller = new AbortController();
    const disk = writable();
    mockConversion.execute.mockImplementationOnce(async () => {
      await emitChunk(0, [1, 2]);
      controller.abort();
      throw new Error('Conversion canceled');
    });
    await expect(convertBrowserVideo(media(), defaults, { signal: controller.signal, saveToDisk: disk })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockConversion.cancel).toHaveBeenCalledTimes(1);
    expect(mockInput.dispose).toHaveBeenCalled();
    expect(disk.close).not.toHaveBeenCalled();
    expect(disk.abort).toHaveBeenCalledTimes(1);
  });
});
