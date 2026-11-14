import { calculateDimensionsFromAspectRatio, generateFileName, validateImageDimensions, validateImageFile } from './imageHelpers';
import { downloadImage, resizeImage } from './canvasUtils';

describe('image tool output contracts', () => {
  test('rejects dimensions that can produce invalid or unbounded canvases', () => {
    for (const [width, height] of [[0, 100], [-1, 100], [1.5, 2], [NaN, 1], [Infinity, 2], [16385, 2], [10000, 10000]]) {
      expect(() => validateImageDimensions(width, height)).toThrow();
    }
    expect(() => validateImageDimensions(4000, 3000)).not.toThrow();
  });

  test('portrait presets use a bounded canvas, including small source images', () => {
    expect(calculateDimensionsFromAspectRatio(3000, 4000, '9:16', 1920)).toEqual({ width: 1080, height: 1920 });
    expect(calculateDimensionsFromAspectRatio(200, 100, '1:1')).toEqual({ width: 200, height: 200 });
  });

  test('accepts the advertised WebP format and rejects empty and unsupported files', () => {
    expect(validateImageFile(new File(['image'], 'photo.webp', { type: 'image/webp' })).isValid).toBe(true);
    expect(validateImageFile(new File([], 'empty.png', { type: 'image/png' })).isValid).toBe(false);
    expect(validateImageFile(new File(['GIF89a'], 'animated.gif', { type: 'image/gif' })).isValid).toBe(false);
    expect(generateFileName('photo.jpg', 'resized', 'png')).toBe('photo_resized.png');
    expect(generateFileName('photo.png', 'converted', 'webp')).toBe('photo_converted.webp');
  });

  test('preset fitting keeps the image proportions and centers transparent padding', () => {
    const drawImage = jest.fn();
    const context = { drawImage, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const image = { width: 400, height: 200 } as HTMLImageElement;
    const canvas = resizeImage(image, { width: 200, height: 200, fit: 'contain' });
    expect([canvas.width, canvas.height]).toEqual([200, 200]);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 50, 200, 100);
    getContext.mockRestore();
  });

  test.each([['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['png', 'image/png']])(
    '%s export requests the matching MIME type', async (format, mime) => {
      jest.useFakeTimers();
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => 'blob:export');
      URL.revokeObjectURL = jest.fn();
      const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const toBlob = jest.fn((callback: BlobCallback, type: string) => callback(new Blob(['output'], { type })));
      try {
        await downloadImage({ toBlob } as unknown as HTMLCanvasElement, `export.${format}`, format, 0.9);
        expect(toBlob).toHaveBeenCalledWith(expect.any(Function), mime, 0.9);
        expect(click).toHaveBeenCalledTimes(1);
        jest.runOnlyPendingTimers();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
      } finally {
        click.mockRestore();
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
        jest.useRealTimers();
      }
    }
  );

  test('does not download a silently substituted PNG under a WebP filename', async () => {
    const canvas = { toBlob: (callback: BlobCallback) => callback(new Blob(['fallback'], { type: 'image/png' })) };
    await expect(downloadImage(canvas as HTMLCanvasElement, 'photo.webp', 'webp')).rejects.toThrow('cannot export');
  });
});
