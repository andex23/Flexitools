/** Image work stays in this browser. Originals are never modified. */
export type CompressionPreset = 'quality' | 'balanced' | 'small';
export type ImageOutputFormat = 'image/webp' | 'image/jpeg' | 'image/png';

export interface ImageCompressionOptions {
  preset: CompressionPreset;
  format: ImageOutputFormat;
  maxWidth?: number;
  maxHeight?: number;
  targetBytes?: number;
}

export interface ImageCompressionResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  keptOriginal: boolean;
  warning?: string;
}

export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_EDGE = 16_384;
const PRESETS = {
  quality: { quality: 0.92, floor: 0.7 },
  balanced: { quality: 0.82, floor: 0.5 },
  small: { quality: 0.68, floor: 0.4 },
};

interface ImageMetadata {
  format: ImageOutputFormat;
  width: number;
  height: number;
  transparency: boolean;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image processing cancelled.', 'AbortError');
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('This image has invalid dimensions.');
  }
  if (width * height > MAX_IMAGE_PIXELS || Math.max(width, height) > MAX_IMAGE_EDGE) {
    throw new Error('This image is too large to safely process in a browser. Use an image under 50 megapixels and 16,384 pixels per side.');
  }
}

export function fitImageDimensions(width: number, height: number, maxWidth?: number, maxHeight?: number) {
  validateDimensions(width, height);
  for (const limit of [maxWidth, maxHeight]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_IMAGE_EDGE)) {
      throw new Error('Enter whole-number dimensions between 1 and 16,384 pixels.');
    }
  }
  const scale = Math.min(1, (maxWidth ?? width) / width, (maxHeight ?? height) / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function readBytes(file: Blob, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  checkAbort(signal);
  if (offset < 0 || offset + length > file.size) throw new Error('This image is incomplete or damaged.');
  const slice = file.slice(offset, offset + length);
  const buffer = typeof slice.arrayBuffer === 'function'
    ? await slice.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', abort);
      reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
      reader.onerror = () => { cleanup(); reject(new Error('Could not read this image.')); };
      reader.onabort = () => { cleanup(); reject(new DOMException('Image processing cancelled.', 'AbortError')); };
      reader.readAsArrayBuffer(slice);
    });
  checkAbort(signal);
  return new Uint8Array(buffer);
}

const textAt = (bytes: Uint8Array, offset: number, length: number) =>
  Array.from(bytes.slice(offset, offset + length)).map(value => String.fromCharCode(value)).join('');
const uint32 = (bytes: Uint8Array, offset: number, littleEndian = false) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, littleEndian);
const uint24 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

/** Read dimensions before decoding, and reject animations instead of silently flattening them. */
export async function readImageMetadata(file: Blob, signal?: AbortSignal): Promise<ImageMetadata> {
  checkAbort(signal);
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image smaller than 100 MB. Large videos have their own tool.');
  if (file.size < 12) throw new Error('Choose a valid JPG, PNG, or WebP image.');
  const header = await readBytes(file, 0, Math.min(file.size, 32), signal);
  let metadata: ImageMetadata | undefined;

  if (header[0] === 137 && textAt(header, 1, 3) === 'PNG' && header[4] === 13 && header[5] === 10 && header[6] === 26 && header[7] === 10) {
    if (header.length < 29 || textAt(header, 12, 4) !== 'IHDR' || uint32(header, 8) !== 13) {
      throw new Error('This PNG is incomplete or damaged.');
    }
    metadata = { format: 'image/png', width: uint32(header, 16), height: uint32(header, 20), transparency: [4, 6].includes(header[25]) };
    validateDimensions(metadata.width, metadata.height);
    let offset = 8;
    let foundImageData = false;
    for (let chunks = 0; offset + 8 <= file.size && chunks < 4096; chunks++) {
      const chunk = await readBytes(file, offset, 8, signal);
      const length = uint32(chunk, 0);
      const type = textAt(chunk, 4, 4);
      if (offset + length + 12 > file.size) throw new Error('This PNG is incomplete or damaged.');
      if (type === 'acTL') throw new Error('Animated PNGs are not supported. Use a still PNG to preserve its contents.');
      if (type === 'tRNS') metadata.transparency = true;
      // The PNG animation control chunk must precede the first IDAT chunk.
      if (type === 'IDAT') { foundImageData = true; break; }
      offset += length + 12;
    }
    if (!foundImageData) throw new Error('This PNG has no readable image data.');
  } else if (textAt(header, 0, 4) === 'RIFF' && textAt(header, 8, 4) === 'WEBP') {
    const containerSize = uint32(header, 4, true) + 8;
    if (containerSize > file.size) throw new Error('This WebP is incomplete or damaged.');
    let offset = 12;
    for (let chunks = 0; offset + 8 <= containerSize && chunks < 4096; chunks++) {
      const chunk = await readBytes(file, offset, 8, signal);
      const type = textAt(chunk, 0, 4);
      const length = uint32(chunk, 4, true);
      if (offset + length + 8 > containerSize) throw new Error('This WebP is incomplete or damaged.');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('Animated WebP images are not supported. Use a still image to preserve its contents.');
      if (type === 'VP8X') {
        if (length < 10) throw new Error('This WebP header is damaged.');
        const data = await readBytes(file, offset + 8, 10, signal);
        if (data[0] & 2) throw new Error('Animated WebP images are not supported. Use a still image to preserve its contents.');
        metadata = { format: 'image/webp', width: uint24(data, 4) + 1, height: uint24(data, 7) + 1, transparency: Boolean(data[0] & 16) };
        validateDimensions(metadata.width, metadata.height);
      } else if (type === 'VP8 ' && !metadata) {
        if (length < 10) throw new Error('This WebP header is damaged.');
        const data = await readBytes(file, offset + 8, 10, signal);
        if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw new Error('This WebP header is damaged.');
        metadata = { format: 'image/webp', width: (data[6] | (data[7] << 8)) & 0x3fff, height: (data[8] | (data[9] << 8)) & 0x3fff, transparency: false };
      } else if (type === 'VP8L' && !metadata) {
        if (length < 5) throw new Error('This WebP header is damaged.');
        const data = await readBytes(file, offset + 8, 5, signal);
        if (data[0] !== 0x2f) throw new Error('This WebP header is damaged.');
        const bits = uint32(data, 1, true);
        metadata = { format: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, transparency: Boolean(bits & 0x10000000) };
      }
      offset += 8 + length + (length % 2);
    }
  } else if (header[0] === 0xff && header[1] === 0xd8) {
    let offset = 2;
    for (let segments = 0; offset + 4 <= file.size && segments < 4096; segments++) {
      const prefix = await readBytes(file, offset, 2, signal);
      if (prefix[0] !== 0xff) throw new Error('This JPG header is damaged.');
      if (prefix[1] === 0xff) { offset++; continue; }
      const marker = prefix[1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const sizeBytes = await readBytes(file, offset + 2, 2, signal);
      const length = (sizeBytes[0] << 8) | sizeBytes[1];
      if (length < 2 || offset + length + 2 > file.size) throw new Error('This JPG is incomplete or damaged.');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new Error('This JPG header is damaged.');
        const data = await readBytes(file, offset + 4, 5, signal);
        metadata = { format: 'image/jpeg', width: (data[3] << 8) | data[4], height: (data[1] << 8) | data[2], transparency: false };
        break;
      }
      offset += length + 2;
    }
  }

  if (!metadata) throw new Error('Choose a valid JPG, PNG, or still WebP image.');
  validateDimensions(metadata.width, metadata.height);
  return metadata;
}

function decodeImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
    };
    const abort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Image processing cancelled.', 'AbortError'));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('Your browser could not decode this image. Try exporting it as JPG or PNG first.')); };
    signal?.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, format: ImageOutputFormat, quality: number, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Image processing cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob(blob => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { abort(); return; }
        if (!blob) { reject(new Error('Could not encode this image. Try smaller dimensions.')); return; }
        if (blob.type !== format) { reject(new Error('Your browser cannot export this format. Choose JPG or PNG.')); return; }
        resolve(blob);
      }, format, quality);
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

/** Find the highest tested quality that meets the target, without dropping below the preset's quality floor. */
export async function encodeForTarget(
  encode: (quality: number) => Promise<Blob>,
  preset: CompressionPreset,
  targetBytes?: number,
  signal?: AbortSignal,
): Promise<Blob> {
  checkAbort(signal);
  if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) throw new Error('Choose a valid quality preset.');
  if (targetBytes !== undefined && (!Number.isSafeInteger(targetBytes) || targetBytes < 1)) throw new Error('Enter a positive target file size.');
  const settings = PRESETS[preset];
  const initial = await encode(settings.quality);
  checkAbort(signal);
  if (targetBytes === undefined || initial.size <= targetBytes) return initial;
  const floor = await encode(settings.floor);
  checkAbort(signal);
  if (floor.size > targetBytes) return floor.size < initial.size ? floor : initial;
  let best = floor;
  let low = settings.floor;
  let high = settings.quality;
  for (let step = 0; step < 7; step++) {
    const middle = (low + high) / 2;
    const candidate = await encode(middle);
    checkAbort(signal);
    if (candidate.size <= targetBytes) { best = candidate; low = middle; }
    else high = middle;
  }
  return best;
}

export async function compressImage(file: File, options: ImageCompressionOptions, signal?: AbortSignal): Promise<ImageCompressionResult> {
  checkAbort(signal);
  if (!Object.prototype.hasOwnProperty.call(PRESETS, options.preset)) throw new Error('Choose a valid quality preset.');
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(options.format)) throw new Error('Choose JPG, PNG, or WebP output.');
  if (options.targetBytes !== undefined && (!Number.isSafeInteger(options.targetBytes) || options.targetBytes < 1)) throw new Error('Enter a positive target file size.');
  const metadata = await readImageMetadata(file, signal);
  // Validate options before decoding even if the browser applies EXIF orientation later.
  fitImageDimensions(metadata.width, metadata.height, options.maxWidth, options.maxHeight);
  const image = await decodeImage(file, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkAbort(signal);
    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;
    const { width, height } = fitImageDimensions(originalWidth, originalHeight, options.maxWidth, options.maxHeight);
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not create an image canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (options.format === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const encode = (quality: number) => encodeCanvas(canvas!, options.format, quality, signal);
    let blob = options.format === 'image/png'
      ? await encode(1)
      : await encodeForTarget(encode, options.preset, options.targetBytes, signal);
    checkAbort(signal);
    const keptOriginal = blob.size >= file.size && options.format === metadata.format && width === originalWidth && height === originalHeight;
    if (keptOriginal) blob = file.type === metadata.format ? file : new Blob([file], { type: metadata.format });
    const warnings: string[] = [];
    if (keptOriginal) warnings.push('This image is already smaller than the processed result. Your original is kept.');
    else {
      if (options.format === 'image/jpeg' && metadata.transparency) warnings.push('JPG does not support transparency. Transparent areas have a white background.');
      if (blob.size >= file.size) warnings.push('These dimensions or this format produced a larger file. Try WebP or a smaller size.');
    }
    if (options.targetBytes !== undefined && blob.size > options.targetBytes) {
      warnings.push(options.format === 'image/png'
        ? 'The target size could not be reached with lossless PNG encoding. Try WebP, JPG, or smaller dimensions.'
        : 'The target size could not be reached within this preset’s quality range. Try smaller dimensions or the Small file preset.');
    }
    return { blob, width, height, originalWidth, originalHeight, keptOriginal, warning: warnings.length ? warnings.join(' ') : undefined };
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    image.src = '';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1));
  return `${Number((bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 2))} ${units[exponent]}`;
}

export function outputFilename(filename: string, format: ImageOutputFormat, keptOriginal = false): string {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[format];
  const stem = filename.replace(/\.[^/.]+$/, '') || 'image';
  return `${stem}${keptOriginal ? '-original' : '-optimized'}.${extension}`;
}
