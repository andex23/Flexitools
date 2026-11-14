import { editImage, editedFilename, getEditGeometry, ImageRotation, inspectImageForEditing, normalizeWatermark } from './imageEditing';

// A minimal JPEG header lets the real header validator run before the mocked browser decoder.
function jpeg(width = 800, height = 600) {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 0, 0xff, 0xd9])], 'photo.jpg', { type: 'image/jpeg' });
}

describe('crop and rotate geometry', () => {
  it('preserves crop proportions and swaps axes only for quarter turns', () => {
    const crop = { x: 100, y: 200, width: 500, height: 300 };
    expect(getEditGeometry(800, 600)).toEqual({ crop: { x: 0, y: 0, width: 800, height: 600 }, width: 800, height: 600, rotation: 0 });
    for (const rotation of [0, 90, 180, 270] as ImageRotation[]) {
      expect(getEditGeometry(800, 600, crop, rotation)).toMatchObject({
        crop, width: rotation % 180 ? 300 : 500, height: rotation % 180 ? 500 : 300,
      });
    }
    expect(getEditGeometry(800, 600, { x: 799, y: 599, width: 1, height: 1 }, 270)).toMatchObject({ width: 1, height: 1 });
  });

  it('rejects off-image, fractional, empty, and invalid geometry', () => {
    const valid = { x: 0, y: 0, width: 800, height: 600 };
    for (const invalid of [{ x: -1 }, { y: 1 }, { width: 801 }, { height: 0 }, { width: 1.5 }, { x: NaN }, { y: Infinity }]) {
      expect(() => getEditGeometry(800, 600, { ...valid, ...invalid })).toThrow('whole pixels');
    }
    expect(() => getEditGeometry(800, 600, undefined, 45 as ImageRotation)).toThrow('90-degree');
    expect(() => getEditGeometry(10000, 10000)).toThrow('50 megapixels');
  });

  it('bounds watermark settings and preserves whole Unicode code points', () => {
    const watermark = { text: '  Name\nHere  ', position: 'center' as const, opacity: 0.7, sizePercent: 5 };
    expect(normalizeWatermark(watermark)?.text).toBe('Name Here');
    expect(normalizeWatermark({ ...watermark, text: '\u0001' })).toBeUndefined();
    expect(Array.from(normalizeWatermark({ ...watermark, text: '🌴'.repeat(101) })!.text)).toHaveLength(100);
    expect(() => normalizeWatermark({ ...watermark, opacity: 0 })).toThrow('opacity');
    expect(() => normalizeWatermark({ ...watermark, sizePercent: Infinity })).toThrow('size');
  });
});

describe('browser image editing', () => {
  const originalCreateURL = URL.createObjectURL;
  const originalRevokeURL = URL.revokeObjectURL;
  let context: Record<string, any>;
  let canvas: HTMLCanvasElement | undefined;
  let decodedImages: HTMLImageElement[];
  let sourceValues: string[];

  beforeEach(() => {
    canvas = undefined;
    decodedImages = [];
    sourceValues = [];
    URL.createObjectURL = jest.fn(() => 'blob:editor-test');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(window, 'Image').mockImplementation(() => {
      const image = document.createElement('img');
      decodedImages.push(image);
      Object.defineProperties(image, {
        naturalWidth: { value: 800 }, naturalHeight: { value: 600 },
        src: { set(value: string) { sourceValues.push(value); if (value) Promise.resolve().then(() => image.onload?.(new Event('load'))); } },
      });
      return image;
    });
    context = {
      save: jest.fn(), restore: jest.fn(), translate: jest.fn(), rotate: jest.fn(),
      drawImage: jest.fn(), fillRect: jest.fn(), measureText: jest.fn(() => ({ width: 120 })),
      strokeText: jest.fn(), fillText: jest.fn(),
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(this: HTMLCanvasElement) {
      canvas = this;
      return context as CanvasRenderingContext2D;
    });
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => callback(new Blob([new Uint8Array(1000)], { type })));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    URL.createObjectURL = originalCreateURL;
    URL.revokeObjectURL = originalRevokeURL;
  });

  it('validates format, size, and animation before creating a decoder', async () => {
    await expect(inspectImageForEditing(new File(['not image data at all'], 'photo.png'))).rejects.toThrow('valid JPG');
    const large = jpeg();
    Object.defineProperty(large, 'size', { value: 100 * 1024 * 1024 + 1 });
    await expect(inspectImageForEditing(large)).rejects.toThrow('100 MB');
    // RIFF/WEBP with VP8X animation flag.
    const animated = new File([new Uint8Array([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 2, 0, 0, 0, 255, 3, 0, 255, 1, 0])], 'animated.webp');
    await expect(inspectImageForEditing(animated)).rejects.toThrow('Animated WebP');
    expect(window.Image).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('draws the exact source crop and rotates around the output center', async () => {
    const result = await editImage(jpeg(), { mode: 'edit', format: 'image/png', crop: { x: 100, y: 150, width: 500, height: 300 }, rotation: 90 });
    expect(result).toMatchObject({ width: 300, height: 500, originalWidth: 800, originalHeight: 600 });
    expect(context.translate).toHaveBeenCalledWith(150, 250);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.drawImage).toHaveBeenCalledWith(decodedImages[0], 100, 150, 500, 300, -250, -150, 500, 300);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(canvas?.width).toBe(0);
    expect(canvas?.height).toBe(0);
    expect(sourceValues[sourceValues.length - 1]).toBe('');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-test');
  });

  it('always re-encodes metadata removal, ignoring hidden edit settings and keeping a larger result', async () => {
    const original = jpeg();
    const result = await editImage(original, { mode: 'metadata', format: 'image/png', crop: { x: -1, y: 0, width: 0, height: 0 }, rotation: 90, watermark: { text: 'Hidden', position: 'center', opacity: 0.5, sizePercent: 5 } });
    expect(result).toMatchObject({ width: 800, height: 600 });
    expect(result.blob).not.toBe(original);
    expect(result.blob.size).toBeGreaterThan(original.size);
    expect(context.rotate).toHaveBeenCalledWith(0);
    expect(context.fillText).not.toHaveBeenCalled();
    expect(result.warning).toContain('metadata are not copied');
  });

  it('flattens JPG transparency before drawing and adds the requested watermark', async () => {
    const result = await editImage(jpeg(), { mode: 'edit', format: 'image/jpeg', watermark: { text: 'My photo', position: 'center', opacity: 0.5, sizePercent: 5 } });
    expect(result.blob.type).toBe('image/jpeg');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
    expect(context.fillText).toHaveBeenCalledWith('My photo', 400, 300);
    expect(context.textAlign).toBe('center');
    expect(result.warning).toContain('white for JPG');
  });

  it('rejects browser format fallback and frees the canvas', async () => {
    jest.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
    await expect(editImage(jpeg(), { mode: 'edit', format: 'image/webp' })).rejects.toThrow('cannot export this format');
    expect(canvas?.width).toBe(0);
  });

  it('cancels pending encoding and discards a late completed blob', async () => {
    const controller = new AbortController();
    let finish: BlobCallback | undefined;
    let started!: () => void;
    const encoding = new Promise<void>(resolve => { started = resolve; });
    jest.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => { finish = callback; started(); });
    const pending = editImage(jpeg(), { mode: 'edit', format: 'image/png' }, controller.signal);
    await encoding;
    controller.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    finish?.(new Blob(['late'], { type: 'image/png' }));
    expect(canvas?.width).toBe(0);
    expect(sourceValues[sourceValues.length - 1]).toBe('');
  });
});

it('names downloads using their real output type and selected operation', () => {
  expect(editedFilename('photo.PNG', 'image/webp', 'edit')).toBe('photo-edited.webp');
  expect(editedFilename('photo', 'image/jpeg', 'metadata')).toBe('photo-metadata-removed.jpg');
});
