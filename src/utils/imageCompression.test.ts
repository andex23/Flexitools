import {
  compressImage, encodeForTarget, fitImageDimensions, formatBytes, MAX_IMAGE_BYTES,
  outputFilename, readImageMetadata,
} from './imageCompression';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (value: string) => new Uint8Array(Array.from(value).map(char => char.charCodeAt(0)));
function word(value: number, littleEndian = false) {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, littleEndian);
  return new Uint8Array(buffer);
}
function pngChunk(type: string, data: Uint8Array) {
  return [word(data.length), ascii(type), data, bytes(0, 0, 0, 0)];
}
function png(width = 400, height = 200, animated = false) {
  return new File([
    bytes(137, 80, 78, 71, 13, 10, 26, 10),
    ...pngChunk('IHDR', new Uint8Array([...Array.from(word(width)), ...Array.from(word(height)), 8, 6, 0, 0, 0])),
    ...(animated ? pngChunk('acTL', bytes(0, 0, 0, 2, 0, 0, 0, 0)) : []),
    ...pngChunk('IDAT', bytes(1, 2, 3)),
    ...pngChunk('IEND', bytes()),
  ], 'photo.png', { type: 'image/png' });
}
function webp(animated = false) {
  const data = bytes(animated ? 2 : 16, 0, 0, 0, 0xff, 0x03, 0, 0xff, 0x01, 0);
  return new File([ascii('RIFF'), word(22, true), ascii('WEBPVP8X'), word(10, true), data], 'photo.webp', { type: 'image/webp' });
}

describe('safe proportional resizing', () => {
  it('fits both limits, preserves proportions, and does not upscale', () => {
    expect(fitImageDimensions(4000, 3000, 1920, 1080)).toEqual({ width: 1440, height: 1080 });
    expect(fitImageDimensions(3000, 4000, 1080)).toEqual({ width: 1080, height: 1440 });
    expect(fitImageDimensions(640, 480, 1920, 1080)).toEqual({ width: 640, height: 480 });
  });

  it('rejects invalid dimensions and excessive decoded image memory before canvas allocation', () => {
    expect(() => fitImageDimensions(10000, 10000)).toThrow('50 megapixels');
    expect(() => fitImageDimensions(20000, 1)).toThrow('16,384');
    for (const value of [0, -1, 2.5, NaN, Infinity]) {
      expect(() => fitImageDimensions(400, 200, value)).toThrow();
    }
  });
});

describe('image header checks', () => {
  it('reads PNG dimensions and transparency without trusting the filename', async () => {
    await expect(readImageMetadata(png())).resolves.toEqual({ format: 'image/png', width: 400, height: 200, transparency: true });
    await expect(readImageMetadata(webp())).resolves.toEqual({ format: 'image/webp', width: 1024, height: 512, transparency: true });
  });

  it('reads baseline and progressive JPEG dimensions', async () => {
    for (const marker of [0xc0, 0xc2]) {
      const image = new File([bytes(0xff, 0xd8, 0xff, marker, 0, 8, 8, 0x02, 0x58, 0x03, 0x20, 0, 0xff, 0xd9)], 'photo.jpg');
      await expect(readImageMetadata(image)).resolves.toEqual({ format: 'image/jpeg', width: 800, height: 600, transparency: false });
    }
  });

  it('rejects animation rather than silently turning it into a still image', async () => {
    await expect(readImageMetadata(png(400, 200, true))).rejects.toThrow('Animated PNG');
    await expect(readImageMetadata(webp(true))).rejects.toThrow('Animated WebP');
  });

  it('rejects damaged, unsupported, and oversized files', async () => {
    await expect(readImageMetadata(png(10000, 10000))).rejects.toThrow('50 megapixels');
    await expect(readImageMetadata(new File([ascii('GIF89a fake image data')], 'image.gif'))).rejects.toThrow('valid JPG');
    await expect(readImageMetadata(png().slice(0, 33))).rejects.toThrow('no readable image data');
    const large = png();
    Object.defineProperty(large, 'size', { value: MAX_IMAGE_BYTES + 1 });
    await expect(readImageMetadata(large)).rejects.toThrow('100 MB');
  });
});

describe('target size and quality tradeoffs', () => {
  it('stops as soon as the preset already meets the target', async () => {
    const encode = jest.fn(async () => new Blob([new Uint8Array(400)]));
    expect((await encodeForTarget(encode, 'quality', 1000)).size).toBe(400);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(0.92);
  });

  it('keeps the highest tested quality within the target', async () => {
    const encode = jest.fn(async (quality: number) => new Blob([new Uint8Array(Math.round(quality * 1000))]));
    const result = await encodeForTarget(encode, 'quality', 800);
    expect(result.size).toBeLessThanOrEqual(800);
    expect(result.size).toBeGreaterThanOrEqual(798);
    expect(encode.mock.calls.every(([quality]) => quality >= 0.7 && quality <= 0.92)).toBe(true);
  });

  it('respects the quality floor when the requested size is unrealistic', async () => {
    const encode = jest.fn(async (quality: number) => new Blob([new Uint8Array(Math.round(quality * 1000))]));
    expect((await encodeForTarget(encode, 'quality', 100)).size).toBe(700);
    expect(encode.mock.calls.map(([quality]) => quality)).toEqual([0.92, 0.7]);
  });

  it('does not continue encoding after cancellation', async () => {
    const controller = new AbortController();
    const encode = jest.fn(async () => { controller.abort(); return new Blob([new Uint8Array(2000)]); });
    await expect(encodeForTarget(encode, 'quality', 1000, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(encode).toHaveBeenCalledTimes(1);
    await expect(compressImage(png(), { preset: 'quality', format: 'image/png' }, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});

describe('compression result contract', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let encodedType: string | undefined;

  beforeEach(() => {
    encodedType = undefined;
    URL.createObjectURL = jest.fn(() => 'blob:test-image');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(window, 'Image').mockImplementation(() => {
      const image = document.createElement('img');
      Object.defineProperties(image, {
        naturalWidth: { value: 400 },
        naturalHeight: { value: 200 },
        src: { set(value: string) { if (value) Promise.resolve().then(() => image.onload?.(new Event('load'))); } },
      });
      return image;
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: jest.fn(), fillRect: jest.fn(),
    } as unknown as CanvasRenderingContext2D);
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob([new Uint8Array(1000)], { type: encodedType || type }));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('keeps an already smaller original when there was no resize or conversion', async () => {
    const original = png();
    const result = await compressImage(original, { preset: 'quality', format: 'image/png' });
    expect(result.blob).toBe(original);
    expect(result.keptOriginal).toBe(true);
    expect(result.warning).toContain('original is kept');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  });

  it('honors an intentional resize even if the encoded result is larger', async () => {
    const result = await compressImage(png(), { preset: 'quality', format: 'image/png', maxWidth: 200 });
    expect(result).toMatchObject({ width: 200, height: 100, originalWidth: 400, originalHeight: 200, keptOriginal: false });
    expect(result.blob.size).toBe(1000);
    expect(result.warning).toContain('larger file');
  });

  it('honors format changes and reports lost transparency and an unmet target', async () => {
    const result = await compressImage(png(), { preset: 'quality', format: 'image/jpeg', targetBytes: 500 });
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.keptOriginal).toBe(false);
    expect(result.warning).toContain('white background');
    expect(result.warning).toContain('target size could not be reached');
  });

  it('rejects browser format fallback rather than downloading a falsely named file', async () => {
    encodedType = 'image/png';
    await expect(compressImage(png(), { preset: 'quality', format: 'image/webp' })).rejects.toThrow('cannot export this format');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('export naming', () => {
  it('uses the output MIME extension, including names without an extension', () => {
    expect(outputFilename('holiday.PNG', 'image/webp')).toBe('holiday-optimized.webp');
    expect(outputFilename('holiday', 'image/jpeg')).toBe('holiday-optimized.jpg');
    expect(outputFilename('archive.photo.png', 'image/png', true)).toBe('archive.photo-original.png');
  });

  it('formats both tiny images and multi-gigabyte media', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3 GB');
    expect(formatBytes(NaN)).toBe('—');
  });
});
