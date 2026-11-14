import { Zip, ZipPassThrough } from 'fflate';
import { compressImage, ImageCompressionOptions, ImageCompressionResult, MAX_IMAGE_BYTES, outputFilename } from './imageCompression';

export const MAX_BATCH_FILES = 25;
export const MAX_BATCH_BYTES = 200 * 1024 * 1024;
export const MAX_BATCH_OUTPUT_BYTES = 200 * 1024 * 1024;

export interface BatchImageEntry {
  file: File;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  result?: ImageCompressionResult;
  downloadName?: string;
  error?: string;
}

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Batch cancelled.', 'AbortError');
};

export function validateBatchFiles(files: readonly File[]): void {
  if (!files.length) throw new Error('Choose at least one image.');
  if (files.length > MAX_BATCH_FILES) throw new Error(`Choose up to ${MAX_BATCH_FILES} images at a time.`);
  if (files.some(file => file.size === 0)) throw new Error('One of these files is empty. Remove it and try again.');
  if (files.some(file => file.size > MAX_IMAGE_BYTES)) throw new Error('Each image must be 100 MB or smaller.');
  if (files.reduce((bytes, file) => bytes + file.size, 0) > MAX_BATCH_BYTES) throw new Error('Choose a batch totaling 200 MB or less.');
}

/** Archives use flat, case-insensitively unique names, even on Windows/macOS. */
export function uniqueDownloadName(proposed: string, used: Set<string>): string {
  // eslint-disable-next-line no-control-regex -- Strip control characters from portable ZIP names.
  const clean = proposed.replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || 'image';
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : '';
  let candidate = clean;
  let number = 2;
  while (used.has(candidate.toLocaleLowerCase('en-US'))) candidate = `${stem} (${number++})${extension}`;
  used.add(candidate.toLocaleLowerCase('en-US'));
  return candidate;
}

/** Process one canvas at a time; failed files do not prevent later successes. */
export async function compressImageBatch(
  files: readonly File[],
  options: ImageCompressionOptions,
  onUpdate: (index: number, entry: BatchImageEntry) => void,
  signal?: AbortSignal,
): Promise<BatchImageEntry[]> {
  validateBatchFiles(files);
  checkAbort(signal);
  const entries: BatchImageEntry[] = [];
  const names = new Set<string>();
  let outputBytes = 0;
  for (let index = 0; index < files.length; index++) {
    checkAbort(signal);
    const file = files[index];
    onUpdate(index, { file, status: 'processing' });
    let entry: BatchImageEntry;
    try {
      const result = await compressImage(file, options, signal);
      checkAbort(signal);
      if (outputBytes + result.blob.size > MAX_BATCH_OUTPUT_BYTES) {
        throw new Error('This result would exceed the 200 MB batch output limit. Try a smaller batch or output size.');
      }
      outputBytes += result.blob.size;
      entry = { file, status: 'completed', result, downloadName: uniqueDownloadName(outputFilename(file.name, options.format, result.keptOriginal), names) };
    } catch (error) {
      checkAbort(signal);
      entry = { file, status: 'failed', error: error instanceof Error ? error.message : 'This image could not be processed.' };
    }
    entries.push(entry);
    onUpdate(index, entry);
  }
  return entries;
}

async function readChunk(blob: Blob, signal?: AbortSignal): Promise<Uint8Array> {
  checkAbort(signal);
  const bytes = typeof blob.arrayBuffer === 'function'
    ? await blob.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      const cleanup = () => signal?.removeEventListener('abort', abort);
      reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
      reader.onerror = () => { cleanup(); reject(new Error('Could not read a compressed image.')); };
      reader.onabort = () => { cleanup(); reject(new DOMException('ZIP creation cancelled.', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      reader.readAsArrayBuffer(blob);
    });
  checkAbort(signal);
  return new Uint8Array(bytes);
}

/** Images are already compressed. Store them in a ZIP without re-deflating them. */
export async function createBatchZip(
  entries: readonly BatchImageEntry[],
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  checkAbort(signal);
  const completed = entries.filter((entry): entry is BatchImageEntry & { result: ImageCompressionResult; downloadName: string } => entry.status === 'completed' && Boolean(entry.result && entry.downloadName));
  if (!completed.length) throw new Error('Compress at least one image before creating a ZIP.');
  if (completed.reduce((bytes, entry) => bytes + entry.result.blob.size, 0) > MAX_BATCH_OUTPUT_BYTES) throw new Error('The ZIP exceeds the 200 MB batch output limit. Download the images individually.');
  const parts: Uint8Array[] = [];
  let zipError: Error | undefined;
  let finished = false;
  const archive = new Zip((error, data, final) => {
    if (error) { zipError = error; return; }
    parts.push(data);
    if (final) finished = true;
  });
  const abort = () => archive.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  const names = new Set<string>();
  try {
    for (let index = 0; index < completed.length; index++) {
      checkAbort(signal);
      const entry = completed[index];
      const file = new ZipPassThrough(uniqueDownloadName(entry.downloadName, names));
      archive.add(file);
      const blob = entry.result.blob;
      for (let offset = 0; offset < blob.size; offset += 64 * 1024) {
        const chunk = await readChunk(blob.slice(offset, offset + 64 * 1024), signal);
        file.push(chunk, offset + chunk.length === blob.size);
        if (zipError) throw zipError;
      }
      if (blob.size === 0) file.push(new Uint8Array(), true);
      onProgress?.(index + 1, completed.length);
    }
    checkAbort(signal);
    archive.end();
    if (zipError) throw zipError;
    if (!finished) throw new Error('The ZIP could not be completed. Try downloading individually.');
    return new Blob(parts, { type: 'application/zip' });
  } finally {
    signal?.removeEventListener('abort', abort);
    archive.terminate();
  }
}
