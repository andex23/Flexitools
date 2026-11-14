import { strFromU8, unzipSync } from 'fflate';
import { compressImage, ImageCompressionResult, MAX_IMAGE_BYTES } from './imageCompression';
import { BatchImageEntry, compressImageBatch, createBatchZip, MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_BATCH_OUTPUT_BYTES, uniqueDownloadName, validateBatchFiles } from './batchImages';

jest.mock('./imageCompression', () => ({ ...jest.requireActual('./imageCompression'), compressImage: jest.fn() }));
const mockCompressImage = compressImage as jest.MockedFunction<typeof compressImage>;
const options = { preset: 'quality' as const, format: 'image/webp' as const };
function file(name = 'photo.png', size = 100) {
  const image = new File(['source'], name, { type: 'image/png' });
  Object.defineProperty(image, 'size', { value: size });
  return image;
}
function result(content = 'encoded'): ImageCompressionResult {
  return { blob: new Blob([content], { type: 'image/webp' }), width: 40, height: 30, originalWidth: 40, originalHeight: 30, keptOriginal: false };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function read(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
function completed(name: string, content: string): BatchImageEntry {
  return { file: file(), status: 'completed', result: result(content), downloadName: name };
}
beforeEach(() => mockCompressImage.mockReset());

describe('batch validation', () => {
  it('enforces per-file, batch count, and combined input memory limits before processing', () => {
    expect(() => validateBatchFiles([])).toThrow('at least one');
    expect(() => validateBatchFiles([file('empty.png', 0)])).toThrow('empty');
    expect(() => validateBatchFiles(Array.from({ length: MAX_BATCH_FILES + 1 }, () => file()))).toThrow('25');
    expect(() => validateBatchFiles([file('huge.png', MAX_IMAGE_BYTES + 1)])).toThrow('100 MB');
    expect(() => validateBatchFiles([file('1.png', MAX_BATCH_BYTES / 2), file('2.png', MAX_BATCH_BYTES / 2), file()])).toThrow('200 MB');
    expect(() => validateBatchFiles([file('1.png', MAX_BATCH_BYTES / 2), file('2.png', MAX_BATCH_BYTES / 2)])).not.toThrow();
  });
  it('uses safe, case-insensitively unique filenames without overwriting numbered originals', () => {
    const used = new Set<string>();
    expect(uniqueDownloadName('photo.webp', used)).toBe('photo.webp');
    expect(uniqueDownloadName('photo (2).webp', used)).toBe('photo (2).webp');
    expect(uniqueDownloadName('PHOTO.webp', used)).toBe('PHOTO (3).webp');
    expect(uniqueDownloadName('../nested\\photo.webp', used)).toBe('_nested_photo.webp');
    expect(uniqueDownloadName('', used)).toBe('image');
  });
});

describe('sequential compression', () => {
  it('waits for one image to release its canvas before starting the next and continues past a rejected image', async () => {
    const first = deferred<ImageCompressionResult>();
    mockCompressImage.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('Animated WebP is not supported.')).mockResolvedValueOnce(result('third'));
    const update = jest.fn();
    const pending = compressImageBatch([file('same.png'), file('animation.webp'), file('same.png')], options, update);
    expect(mockCompressImage).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(0, expect.objectContaining({ status: 'processing' }));
    first.resolve(result());
    const entries = await pending;
    expect(mockCompressImage).toHaveBeenCalledTimes(3);
    expect(entries.map(entry => entry.status)).toEqual(['completed', 'failed', 'completed']);
    expect(entries[1].error).toMatch(/Animated WebP/);
    expect(entries[0].downloadName).toBe('same-optimized.webp');
    expect(entries[2].downloadName).toBe('same-optimized (2).webp');
  });
  it('stops the queue and does not publish a result that finishes after cancellation', async () => {
    const first = deferred<ImageCompressionResult>();
    mockCompressImage.mockReturnValueOnce(first.promise);
    const controller = new AbortController();
    const update = jest.fn();
    const pending = compressImageBatch([file(), file('next.png')], options, update, controller.signal);
    controller.abort();
    first.resolve(result());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCompressImage).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('bounds retained output size without discarding earlier valid downloads', async () => {
    const huge = result();
    Object.defineProperty(huge.blob, 'size', { value: MAX_BATCH_OUTPUT_BYTES });
    mockCompressImage.mockResolvedValueOnce(huge).mockResolvedValueOnce(result());
    const entries = await compressImageBatch([file(), file('second.png')], options, jest.fn());
    expect(entries[0].status).toBe('completed');
    expect(entries[1].status).toBe('failed');
    expect(entries[1].error).toMatch(/batch output limit/);
    expect(entries[1].result).toBeUndefined();
  });
  it('preserves original-kept metadata and warnings for honest reporting', async () => {
    mockCompressImage.mockResolvedValue({ ...result('original'), keptOriginal: true, warning: 'Original already smaller.' });
    const [entry] = await compressImageBatch([file()], options, jest.fn());
    expect(entry.downloadName).toBe('photo-original.webp');
    expect(entry.result).toMatchObject({ keptOriginal: true, warning: 'Original already smaller.' });
  });
});

describe('downloadable ZIP', () => {
  it('round-trips actual bytes across chunks, preserves duplicates, and excludes failures', async () => {
    const text = 'image data '.repeat(9000);
    const progress = jest.fn();
    const archive = await createBatchZip([
      completed('same.webp', text), completed('same.webp', 'second'),
      { file: file('bad.png'), status: 'failed', error: 'Not supported' },
    ], undefined, progress);
    const unpacked = unzipSync(await read(archive));
    expect(archive.type).toBe('application/zip');
    expect(Object.keys(unpacked)).toEqual(['same.webp', 'same (2).webp']);
    expect(strFromU8(unpacked['same.webp'])).toBe(text);
    expect(strFromU8(unpacked['same (2).webp'])).toBe('second');
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
  it('rejects an empty or oversized archive before reading it', async () => {
    await expect(createBatchZip([])).rejects.toThrow('at least one');
    const entry = completed('large.webp', 'data');
    Object.defineProperty(entry.result!.blob, 'size', { value: MAX_BATCH_OUTPUT_BYTES + 1 });
    await expect(createBatchZip([entry])).rejects.toThrow('200 MB');
  });
  it('cancels between files and does not produce a partial archive', async () => {
    const controller = new AbortController();
    const progress = jest.fn(() => controller.abort());
    await expect(createBatchZip([completed('first.webp', 'first'), completed('second.webp', 'second')], controller.signal, progress)).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toHaveBeenCalledTimes(1);
  });
});
