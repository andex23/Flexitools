import {
  ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, OggOutputFormat,
  Output, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, StreamTarget, WavOutputFormat,
  WebMOutputFormat, canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import type { AudioCodec, InputAudioTrack, InputVideoTrack, StreamTargetChunk, VideoCodec } from 'mediabunny';

export const BROWSER_VIDEO_INPUT_LIMIT = 500 * 1024 ** 2;
export const BROWSER_VIDEO_OUTPUT_LIMIT = 256 * 1024 ** 2;
export const BROWSER_VIDEO_DISK_INPUT_LIMIT = 4 * 1024 ** 3;
const DISK_OUTPUT_LIMIT = 4 * 1024 ** 3 - 1;
const MEMORY_BLOCK_SIZE = 1024 ** 2;

export type BrowserVideoFormat = 'mp4' | 'webm' | 'm4a' | 'ogg' | 'wav';
export interface BrowserVideoMetadata {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}
export interface BrowserVideoCapabilities {
  supported: boolean;
  videoFormats: ('mp4' | 'webm')[];
  audioFormats: ('m4a' | 'ogg' | 'wav')[];
  canSaveToDisk: boolean;
  reason?: string;
}
export interface BrowserVideoSettings {
  operation: 'video' | 'audio';
  format: BrowserVideoFormat;
  preset: 'quality' | 'balanced' | 'small';
  /** Maximum display height, or 0 to retain the source dimensions. Never upscales. */
  maxHeight: number;
  trimStart: number;
  trimEnd?: number;
  mute: boolean;
}
/** A File System Access writable opened by the UI in a user gesture. */
export interface BrowserVideoWritable {
  write(data: { type: 'write'; position: number; data: Uint8Array }): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
export interface BrowserVideoResult {
  blob?: Blob;
  savedToDisk: boolean;
  filename: string;
  mimeType: string;
  outputBytes: number;
  width?: number;
  height?: number;
  duration: number;
  warning?: string;
}
export interface BrowserVideoConversionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  saveToDisk?: BrowserVideoWritable;
}

const QUALITY = { quality: QUALITY_HIGH, balanced: QUALITY_MEDIUM, small: QUALITY_LOW };
const AUDIO_CODEC: Record<BrowserVideoFormat, AudioCodec> = {
  mp4: 'aac', webm: 'opus', m4a: 'aac', ogg: 'opus', wav: 'pcm-s16',
};
const MIME_TYPE: Record<BrowserVideoFormat, string> = {
  mp4: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
};

function aborted(): DOMException {
  return new DOMException('Media processing was canceled.', 'AbortError');
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted();
}
function hasBrowserApi(name: string): boolean {
  return typeof (globalThis as unknown as Record<string, unknown>)[name] !== 'undefined';
}
function requireSecureContext(): void {
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    throw new Error('Browser media processing needs HTTPS or localhost. Open the secure website and try again.');
  }
}

/** Probe actual encoders; a browser name alone cannot establish codec support. */
export async function getBrowserVideoCapabilities(): Promise<BrowserVideoCapabilities> {
  const canSaveToDisk = hasBrowserApi('showSaveFilePicker');
  const unavailable = (reason: string): BrowserVideoCapabilities => ({
    supported: false, videoFormats: [], audioFormats: [], canSaveToDisk, reason,
  });
  try {
    requireSecureContext();
    if (!hasBrowserApi('WritableStream')) return unavailable('This browser cannot stream media output. Try a current desktop browser.');
    const canDecodeVideo = hasBrowserApi('VideoDecoder');
    const canDecodeAudio = hasBrowserApi('AudioDecoder');
    const supported = await Promise.all([
      canDecodeVideo ? canEncodeVideo('avc').catch(() => false) : false,
      canDecodeVideo ? canEncodeVideo('vp9').catch(() => false) : false,
      canDecodeAudio ? canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false) : false,
      canDecodeAudio ? canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: 48000 }).catch(() => false) : false,
    ]);
    const videoFormats: ('mp4' | 'webm')[] = [];
    const audioFormats: ('m4a' | 'ogg' | 'wav')[] = [];
    if (supported[0]) videoFormats.push('mp4');
    if (supported[1]) videoFormats.push('webm');
    if (supported[2]) audioFormats.push('m4a');
    if (supported[3]) audioFormats.push('ogg');
    if (canDecodeAudio) audioFormats.push('wav');
    return videoFormats.length || audioFormats.length
      ? { supported: true, videoFormats, audioFormats, canSaveToDisk }
      : unavailable('This browser does not provide the media codecs needed for processing. Try a current desktop Chrome or Edge browser; codec support also depends on your operating system.');
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'Could not check this browser’s media codecs.');
  }
}

function validateFile(file: File, saveToDisk: boolean): void {
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('Choose a non-empty media file.');
  if (file.size > BROWSER_VIDEO_DISK_INPUT_LIMIT) {
    throw new Error('This browser tool accepts files up to 4 GiB. For larger files, use the free desktop HandBrake app.');
  }
  if (!saveToDisk && file.size > BROWSER_VIDEO_INPUT_LIMIT) {
    throw new Error('Files over 500 MiB need “Save directly to disk” in a browser that supports it. Otherwise, use a smaller file or the free desktop HandBrake app.');
  }
}

function openInput(file: File): Input {
  // BlobSource reads file ranges on demand. Never copy a multi-GB input into an ArrayBuffer.
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file, { maxCacheSize: 8 * 1024 ** 2 }) });
}

async function readMetadata(input: Input): Promise<{
  metadata: BrowserVideoMetadata;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
}> {
  if (!await input.canRead()) throw new Error('This media container is not supported or the file is damaged. Try an MP4, MOV, WebM, or common audio file.');
  const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  if (!video && !audio) throw new Error('No readable video or audio track was found in this file.');
  const tracks = [...(video ? [video] : []), ...(audio ? [audio] : [])];
  const [duration, width, height] = await Promise.all([
    input.computeDuration(tracks),
    video ? video.getDisplayWidth() : 0,
    video ? video.getDisplayHeight() : 0,
  ]);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('This file has no readable media duration.');
  if (duration > 24 * 60 * 60) throw new Error('This browser tool accepts media up to 24 hours long. Choose a shorter source file.');
  if (video && (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2)) {
    throw new Error('The video dimensions could not be read.');
  }
  if (video && (width > 16384 || height > 16384 || width * height > 40_000_000)) {
    throw new Error('This video exceeds the browser limit of 40 megapixels per frame or 16,384 pixels per side. Use a smaller source file.');
  }
  return { metadata: { duration, width, height, hasAudio: !!audio }, video, audio };
}

export async function inspectBrowserVideo(file: File, signal?: AbortSignal): Promise<BrowserVideoMetadata> {
  checkAbort(signal);
  validateFile(file, true);
  const input = openInput(file);
  const onAbort = () => input.dispose();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const { metadata } = await readMetadata(input);
    checkAbort(signal);
    return metadata;
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

/** Keep aspect ratio and round down to even pixel counts required by common video encoders. */
export function fitBrowserVideoDimensions(width: number, height: number, maxHeight: number): { width: number; height: number } {
  if (![width, height].every(value => Number.isFinite(value) && value >= 2 && value <= 16384)) {
    throw new Error('Video dimensions must be between 2 and 16,384 pixels.');
  }
  if (!Number.isInteger(maxHeight) || maxHeight < 0 || maxHeight > 16384) {
    throw new Error('Choose a valid maximum video height, or 0 for the original size.');
  }
  const scale = maxHeight ? Math.min(1, maxHeight / height) : 1;
  const outputWidth = Math.floor(width * scale / 2) * 2;
  const outputHeight = Math.floor(height * scale / 2) * 2;
  if (outputWidth < 2 || outputHeight < 2) throw new Error('The chosen video height is too small for this aspect ratio.');
  return { width: outputWidth, height: outputHeight };
}

function validateSettings(settings: BrowserVideoSettings, metadata: BrowserVideoMetadata) {
  if (!['video', 'audio'].includes(settings.operation)) throw new Error('Choose video processing or audio extraction.');
  if (!Object.prototype.hasOwnProperty.call(QUALITY, settings.preset)) throw new Error('Choose a valid quality preset.');
  const formats = settings.operation === 'video' ? ['mp4', 'webm'] : ['m4a', 'ogg', 'wav'];
  if (!formats.includes(settings.format)) throw new Error('Choose an output format that matches the selected tool.');
  const start = settings.trimStart;
  const end = settings.trimEnd ?? metadata.duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > metadata.duration || end <= start) {
    throw new Error('Set a trim start and end within the file’s duration; the end must be after the start.');
  }
  if (settings.operation === 'audio' && !metadata.hasAudio) throw new Error('This file has no audio track to extract.');
  return { start, end };
}

function createFormat(format: BrowserVideoFormat) {
  // No in-memory fast-start: a normal seekable MP4 works with both bounded memory and direct disk output.
  switch (format) {
    case 'mp4':
    case 'm4a': return new Mp4OutputFormat({ fastStart: false });
    case 'webm': return new WebMOutputFormat();
    case 'ogg': return new OggOutputFormat();
    case 'wav': return new WavOutputFormat();
  }
}

/** Browser-only conversion. No uploads, API keys, servers, or helper installation. */
export async function convertBrowserVideo(
  file: File,
  settings: BrowserVideoSettings,
  options: BrowserVideoConversionOptions = {},
): Promise<BrowserVideoResult> {
  const { signal, onProgress, saveToDisk } = options;
  let input: Input | undefined;
  let conversion: Conversion | undefined;
  let output: Output | undefined;
  let cancellation: Promise<void> | undefined;
  let diskCommitted = false;
  let outputBytes = 0;
  const blocks: Uint8Array[] = [];
  const cancelConversion = () => {
    if (!cancellation && (conversion || output)) {
      cancellation = (conversion ? conversion.cancel() : output!.cancel()).catch(() => undefined);
    }
    return cancellation;
  };
  const onAbort = () => {
    void cancelConversion();
    input?.dispose();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    checkAbort(signal);
    requireSecureContext();
    validateFile(file, !!saveToDisk);
    if (!hasBrowserApi('WritableStream')) throw new Error('This browser cannot stream media output. Try a current desktop browser.');
    input = openInput(file);
    const { metadata, video, audio } = await readMetadata(input);
    checkAbort(signal);
    const trim = validateSettings(settings, metadata);
    const isVideo = settings.operation === 'video';
    if (isVideo && !video) throw new Error('This file has no video track. Choose Extract audio for audio-only files.');
    const dimensions = isVideo ? fitBrowserVideoDimensions(metadata.width, metadata.height, settings.maxHeight) : undefined;
    const keepAudio = !!audio && (!isVideo || !settings.mute);
    const audioCodec = AUDIO_CODEC[settings.format];
    const videoCodec: VideoCodec = settings.format === 'webm' ? 'vp9' : 'avc';
    const quality = QUALITY[settings.preset];
    if (isVideo) {
      if (await video!.hasHighDynamicRange()) {
        throw new Error('HDR video export is not supported here because browser conversion can change its colors and brightness. Use HandBrake with an HDR-preserving setup, or choose an SDR source. Audio extraction still works.');
      }
      if (!await video!.canDecode()) throw new Error('This browser cannot decode the video’s codec. Try another current desktop browser or use the free desktop HandBrake app.');
      if (!await canEncodeVideo(videoCodec, { ...dimensions, quality })) {
        throw new Error(`This browser cannot encode ${settings.format.toUpperCase()} at the chosen dimensions. Try another output format or a lower resolution.`);
      }
    }
    if (keepAudio) {
      if (!await audio!.canDecode()) throw new Error('This browser cannot decode this audio codec. Try another browser, or select Mute for video output.');
      if (!await canEncodeAudio(audioCodec, { numberOfChannels: 2, sampleRate: 48000, quality })) {
        throw new Error(`This browser cannot encode ${audioCodec.toUpperCase()} audio. Try WebM for video, Ogg or WAV for audio, or select Mute.`);
      }
    }
    checkAbort(signal);
    const outputLimit = saveToDisk ? DISK_OUTPUT_LIMIT : BROWSER_VIDEO_OUTPUT_LIMIT;
    const assertOutputSize = (end: number) => {
      if (!Number.isSafeInteger(end) || end < 0 || end > outputLimit) {
        throw new Error(saveToDisk
          ? 'The output exceeded the 4 GiB browser limit. Choose a shorter trim, lower resolution, or smaller quality preset.'
          : 'The output exceeded the 256 MiB download limit. Choose “Save directly to disk”, a shorter trim, or a smaller preset.');
      }
      outputBytes = Math.max(outputBytes, end);
    };
    const stream = new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        checkAbort(signal);
        assertOutputSize(chunk.position + chunk.data.byteLength);
        if (saveToDisk) {
          await saveToDisk.write(chunk);
          return;
        }
        // Handle seeks/header rewrites without retaining superseded copies of the output.
        let offset = 0;
        while (offset < chunk.data.byteLength) {
          const position = chunk.position + offset;
          const blockIndex = Math.floor(position / MEMORY_BLOCK_SIZE);
          const withinBlock = position % MEMORY_BLOCK_SIZE;
          const length = Math.min(MEMORY_BLOCK_SIZE - withinBlock, chunk.data.byteLength - offset);
          if (!blocks[blockIndex]) blocks[blockIndex] = new Uint8Array(MEMORY_BLOCK_SIZE);
          blocks[blockIndex].set(chunk.data.subarray(offset, offset + length), withinBlock);
          offset += length;
        }
      },
      // A canceled Conversion also closes its target. Commit the user’s disk file ONLY after execute succeeds.
    });
    const target = new StreamTarget(stream, { chunked: true, chunkSize: MEMORY_BLOCK_SIZE });
    target.on('write', ({ end }) => assertOutputSize(end));
    output = new Output({ target, format: createFormat(settings.format) });
    conversion = await Conversion.init({
      input, output, tracks: 'primary', trim, copy: false, tags: {}, showWarnings: false,
      video: isVideo ? {
        ...dimensions, fit: 'contain', codec: videoCodec, quality, forceTranscode: true,
        allowTransformationMetadata: false, hardwareAcceleration: 'no-preference',
      } : { discard: true },
      audio: keepAudio ? {
        codec: audioCodec, quality, forceTranscode: true, numberOfChannels: 2, sampleRate: 48000,
      } : { discard: true },
    });
    checkAbort(signal);
    // A valid video-only output can hide audio codec failure. Never silently lose requested tracks.
    const missingTrack = conversion.discardedTracks.some(track => track.reason !== 'discarded_by_user');
    if (!conversion.isValid || missingTrack) {
      throw new Error('This browser could not prepare all requested media tracks. Try another format or browser; for video, Mute can help when the audio codec is unsupported.');
    }
    conversion.onProgress = progress => onProgress?.(Math.max(0, Math.min(0.99, progress)));
    onProgress?.(0);
    await conversion.execute();
    checkAbort(signal);
    if (!outputBytes) throw new Error('The encoder produced an empty file. Try a different output format.');
    const mimeType = MIME_TYPE[settings.format];
    let blob: Blob | undefined;
    if (saveToDisk) {
      await saveToDisk.close();
      diskCommitted = true;
    } else {
      const parts: Uint8Array[] = [];
      for (let position = 0; position < outputBytes; position += MEMORY_BLOCK_SIZE) {
        const index = position / MEMORY_BLOCK_SIZE;
        const remaining = Math.min(MEMORY_BLOCK_SIZE, outputBytes - position);
        const block = blocks[index] ?? new Uint8Array(remaining);
        parts.push(block.subarray(0, remaining));
      }
      blob = new Blob(parts, { type: mimeType });
    }
    const stem = Array.from(file.name.replace(/\.[^.]+$/, ''))
      .map(character => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character)
      .join('').slice(0, 160) || 'media';
    const warnings = [
      'Exports keep the primary tracks only; extra audio tracks, subtitles, and descriptive metadata are omitted.',
      keepAudio ? 'Audio is converted to 48 kHz stereo.' : '',
      outputBytes >= file.size ? 'This export is not smaller than the original. Try a smaller preset or lower resolution.' : '',
      settings.format === 'wav' ? 'WAV is uncompressed audio and can be much larger than the source.' : '',
    ].filter(Boolean);
    onProgress?.(1);
    return {
      blob, savedToDisk: !!saveToDisk, filename: `${stem}-${isVideo ? 'compressed' : 'audio'}.${settings.format}`,
      mimeType, outputBytes, ...dimensions, duration: trim.end - trim.start, warning: warnings.join(' '),
    };
  } catch (error) {
    await cancelConversion();
    if (signal?.aborted) throw aborted();
    if (error instanceof Error) throw error;
    throw new Error('Media processing failed. Try a smaller file, a lower resolution, or another output format.');
  } finally {
    signal?.removeEventListener('abort', onAbort);
    input?.dispose();
    blocks.length = 0;
    if (saveToDisk && !diskCommitted) {
      // Abort discards the temporary file instead of committing an incomplete export.
      await saveToDisk.abort(signal?.aborted ? aborted() : 'Media export did not complete.').catch(() => undefined);
    }
  }
}
