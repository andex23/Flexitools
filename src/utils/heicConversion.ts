import { ImageOutputFormat } from './imageCompression';

export const MAX_HEIC_BYTES = 30 * 1024 * 1024;
export const MAX_HEIC_PIXELS = 50_000_000;
const MAX_HEIC_EDGE = 16_384;
const STILL_BRANDS = new Set(['heic', 'heix', 'heim', 'heis']);
const SEQUENCE_BRANDS = new Set(['msf1', 'hevc', 'hevx', 'hevm', 'hevs']);
const CONTAINERS = new Set(['meta', 'iprp', 'ipco']);

export interface HeicMetadata {
  width: number;
  height: number;
  brands: string[];
}
export interface HeicResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
}
const aborted = () =>
  new DOMException('HEIC conversion cancelled.', 'AbortError');
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw aborted();
}
const text = (bytes: Uint8Array, start: number, end: number) =>
  Array.from(bytes.subarray(start, end))
    .map((value) => String.fromCharCode(value))
    .join('');

async function fileBytes(
  blob: Blob,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  checkAbort(signal);
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      cleanup();
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error('Could not read this HEIC file.'));
    };
    reader.onabort = () => {
      cleanup();
      reject(aborted());
    };
    reader.readAsArrayBuffer(blob);
  });
}

/** Validate brands and image extent metadata before allocating decoded pixel buffers. */
export async function inspectHeic(
  file: File,
  signal?: AbortSignal,
): Promise<HeicMetadata> {
  checkAbort(signal);
  if (!/\.(heic|heif)$/i.test(file.name))
    throw new Error(
      'Choose a .heic or .heif file. JPG, PNG and WebP have their own converter.',
    );
  if (file.size > MAX_HEIC_BYTES)
    throw new Error('Choose a HEIC file smaller than 30 MB.');
  if (file.size < 24)
    throw new Error('This HEIC file is empty, incomplete, or damaged.');
  const buffer = await fileBytes(file, signal);
  checkAbort(signal);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let brands: string[] = [];
  const extents: { width: number; height: number }[] = [];
  let boxCount = 0;
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 5) throw new Error('This HEIC file has unsupported metadata.');
    let offset = start;
    while (offset < end) {
      if (++boxCount > 4096 || end - offset < 8)
        throw new Error('This HEIC file has incomplete or excessive metadata.');
      let size = view.getUint32(offset);
      const kind = text(bytes, offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (end - offset < 16)
          throw new Error('This HEIC file has an incomplete box.');
        const high = view.getUint32(offset + 8);
        const low = view.getUint32(offset + 12);
        size = high * 0x100000000 + low;
        header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end)
        throw new Error('This HEIC file has invalid metadata lengths.');
      const payload = offset + header;
      const boxEnd = offset + size;
      if (kind === 'ftyp' && depth === 0) {
        if (size < header + 8 || (size - header) % 4 !== 0)
          throw new Error('This file has invalid format metadata.');
        brands = [text(bytes, payload, payload + 4)];
        for (let i = payload + 8; i < boxEnd; i += 4)
          brands.push(text(bytes, i, i + 4));
      } else if (kind === 'ispe') {
        if (boxEnd - payload < 12)
          throw new Error('This HEIC file has incomplete dimensions.');
        const width = view.getUint32(payload + 4);
        const height = view.getUint32(payload + 8);
        if (
          !width ||
          !height ||
          width > MAX_HEIC_EDGE ||
          height > MAX_HEIC_EDGE ||
          width * height > MAX_HEIC_PIXELS
        ) {
          throw new Error(
            'Choose a HEIC image under 50 megapixels and 16,384 pixels per side.',
          );
        }
        extents.push({ width, height });
      } else if (CONTAINERS.has(kind)) {
        const childStart = payload + (kind === 'meta' ? 4 : 0);
        if (childStart > boxEnd)
          throw new Error('This HEIC file has invalid metadata.');
        walk(childStart, boxEnd, depth + 1);
      }
      offset = boxEnd;
    }
  };
  walk(0, bytes.length, 0);
  if (brands.some((brand) => ['avif', 'avis'].includes(brand)))
    throw new Error(
      'This is an AVIF file, not HEIC. Choose a HEIC or HEIF still image.',
    );
  if (brands.some((brand) => SEQUENCE_BRANDS.has(brand)))
    throw new Error(
      'HEIC image sequences are not supported. Export a single still photo first.',
    );
  if (!brands.some((brand) => STILL_BRANDS.has(brand)))
    throw new Error(
      'This file does not identify a supported HEIC still image.',
    );
  if (!extents.length)
    throw new Error(
      'Could not verify this HEIC image’s dimensions. Export a standard still image and try again.',
    );
  checkAbort(signal);
  // The primary image may reference tiles. Reject oversized extents for any image;
  // decoded primary dimensions are checked again after orientation is applied.
  const largest = extents.reduce((a, b) =>
    a.width * a.height > b.width * b.height ? a : b,
  );
  return { ...largest, brands };
}

// heic-to has a shared decoder worker without a terminate API. Keep decodes serial,
// including after cancellation, so cancelled work cannot multiply memory usage.
let decoderQueue: Promise<void> = Promise.resolve();

export async function convertHeic(
  file: File,
  format: ImageOutputFormat,
  signal?: AbortSignal,
): Promise<HeicResult> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(format))
    throw new Error('Choose JPG, PNG, or WebP output.');
  await inspectHeic(file, signal);
  const previous = decoderQueue;
  let release: () => void = () => undefined;
  decoderQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkAbort(signal);
    const { heicTo } = await import('heic-to/csp');
    checkAbort(signal);
    bitmap = await heicTo({ blob: file, type: 'bitmap' });
    checkAbort(signal);
    const { width, height } = bitmap;
    if (
      !width ||
      !height ||
      width > MAX_HEIC_EDGE ||
      height > MAX_HEIC_EDGE ||
      width * height > MAX_HEIC_PIXELS
    ) {
      throw new Error('The decoded image exceeds the 50 megapixel limit.');
    }
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('This browser could not create an image canvas.');
    if (format === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas!.toBlob(
        (result) => {
          if (!result || result.type !== format)
            reject(
              new Error(
                'This browser cannot export that format. Try JPG or PNG.',
              ),
            );
          else resolve(result);
        },
        format,
        0.92,
      ),
    );
    checkAbort(signal);
    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }[format];
    return {
      blob,
      width,
      height,
      filename: `${file.name.replace(/\.[^/.]+$/, '') || 'photo'}-converted.${extension}`,
    };
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error) throw error;
    throw new Error(
      'This HEIC image could not be decoded. Export a standard HEIC still photo and try again.',
    );
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    release();
  }
}
