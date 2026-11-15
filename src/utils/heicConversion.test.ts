import { heicTo } from 'heic-to/csp';
import { convertHeic, inspectHeic, MAX_HEIC_BYTES } from './heicConversion';

// CRA's Jest 27 resolver does not understand this package's subpath exports.
jest.mock('heic-to/csp', () => ({ heicTo: jest.fn() }), { virtual: true });
const decode = heicTo as jest.Mock;
const ascii = (value: string) =>
  Uint8Array.from(value, (character) => character.charCodeAt(0));
const uint32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};
function join(...arrays: Uint8Array[]) {
  const bytes = new Uint8Array(
    arrays.reduce((size, array) => size + array.length, 0),
  );
  let offset = 0;
  arrays.forEach((array) => {
    bytes.set(array, offset);
    offset += array.length;
  });
  return bytes;
}
const box = (kind: string, ...parts: Uint8Array[]) => {
  const contents = join(...parts);
  return join(uint32(contents.length + 8), ascii(kind), contents);
};
function photo({
  brands = ['mif1', 'heic'],
  width = 4032,
  height = 3024,
  name = 'Camera.HEIC',
} = {}) {
  const data = join(
    box('ftyp', ascii(brands[0]), uint32(0), ...brands.slice(1).map(ascii)),
    box(
      'meta',
      uint32(0),
      box(
        'iprp',
        box('ipco', box('ispe', uint32(0), uint32(width), uint32(height))),
      ),
    ),
    box('mdat', new Uint8Array([1, 2, 3, 4])),
  );
  // These are metadata fixtures, not encoded photos. Actual decoding is mocked below.
  const file = new File([data], name, { type: 'image/heic' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(data.buffer),
  });
  return file;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const bitmap = (width = 4032, height = 3024) =>
  ({ width, height, close: jest.fn() }) as unknown as ImageBitmap;
const tick = async () => {
  for (let step = 0; step < 12; step++) await Promise.resolve();
};

afterEach(() => {
  jest.restoreAllMocks();
  decode.mockReset();
});

describe('HEIC container validation', () => {
  it('recognizes HEIC compatibility brands and checks nested dimensions', async () => {
    await expect(inspectHeic(photo())).resolves.toEqual({
      width: 4032,
      height: 3024,
      brands: ['mif1', 'heic'],
    });
  });
  it('rejects misleading extensions, AVIF, ambiguous HEIF and image sequences', async () => {
    await expect(inspectHeic(photo({ name: 'photo.jpg' }))).rejects.toThrow(
      '.heic or .heif',
    );
    await expect(
      inspectHeic(photo({ brands: ['avif', 'mif1', 'heic'] })),
    ).rejects.toThrow('AVIF');
    await expect(inspectHeic(photo({ brands: ['mif1'] }))).rejects.toThrow(
      'supported HEIC',
    );
    await expect(
      inspectHeic(photo({ brands: ['heic', 'msf1'] })),
    ).rejects.toThrow('sequences');
  });
  it('checks byte limits before reading and dimension limits before decoding', async () => {
    const oversized = photo();
    Object.defineProperty(oversized, 'size', { value: MAX_HEIC_BYTES + 1 });
    await expect(convertHeic(oversized, 'image/jpeg')).rejects.toThrow('30 MB');
    await expect(
      convertHeic(photo({ width: 10000, height: 6000 }), 'image/jpeg'),
    ).rejects.toThrow('50 megapixels');
    await expect(
      inspectHeic(photo({ width: 17000, height: 10 })),
    ).rejects.toThrow('16,384');
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects corrupt box lengths and containers without verifiable dimensions', async () => {
    const corrupt = new File(
      [
        join(
          uint32(9999),
          ascii('ftyp'),
          ascii('heic'),
          uint32(0),
          new Uint8Array(8),
        ),
      ],
      'bad.heic',
    );
    await expect(inspectHeic(corrupt)).rejects.toThrow('metadata lengths');
    const noDimensions = new File(
      [box('ftyp', ascii('heic'), uint32(0), ascii('mif1'), ascii('heic'))],
      'nodimensions.heic',
    );
    await expect(inspectHeic(noDimensions)).rejects.toThrow('dimensions');
  });
  it('discards a file read completed after cancellation', async () => {
    const controller = new AbortController();
    const read = deferred<ArrayBuffer>();
    const file = new File(['test'.repeat(10)], 'cancel.heic');
    Object.defineProperty(file, 'arrayBuffer', { value: () => read.promise });
    const pending = inspectHeic(file, controller.signal);
    const caught = pending.catch((error) => error);
    controller.abort();
    read.resolve(new ArrayBuffer(40));
    expect(await caught).toMatchObject({ name: 'AbortError' });
  });
});

describe('HEIC conversion lifecycle', () => {
  function canvas(outputType?: string) {
    const context = {
      fillStyle: '',
      fillRect: jest.fn(),
      drawImage: jest.fn(),
    };
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encode = jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback, type) =>
        callback(new Blob(['encoded'], { type: outputType || type })),
      );
    return { context, encode };
  }
  it('exports high-quality JPG with a correct filename and closes the decoded bitmap', async () => {
    const decoded = bitmap();
    decode.mockResolvedValue(decoded);
    const { context, encode } = canvas();
    const result = await convertHeic(photo(), 'image/jpeg');
    expect(result).toMatchObject({
      filename: 'Camera-converted.jpg',
      width: 4032,
      height: 3024,
    });
    expect(result.blob.type).toBe('image/jpeg');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 4032, 3024);
    expect(encode).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.92,
    );
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });
  it('rejects silent canvas format fallback instead of mislabelling a PNG as WebP', async () => {
    const decoded = bitmap();
    decode.mockResolvedValue(decoded);
    canvas('image/png');
    await expect(convertHeic(photo(), 'image/webp')).rejects.toThrow(
      'cannot export that format',
    );
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });
  it('rechecks the actual decoded size and releases an oversized bitmap', async () => {
    const decoded = bitmap(12000, 12000);
    decode.mockResolvedValue(decoded);
    const { encode } = canvas();
    await expect(convertHeic(photo(), 'image/png')).rejects.toThrow(
      '50 megapixel limit',
    );
    expect(encode).not.toHaveBeenCalled();
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });
  it('waits for cancelled decoding to finish before another conversion and discards the stale output', async () => {
    const first = deferred<ImageBitmap>();
    const stale = bitmap();
    const next = bitmap(200, 100);
    decode.mockReturnValueOnce(first.promise).mockResolvedValueOnce(next);
    const { encode } = canvas();
    const controller = new AbortController();
    const pending = convertHeic(photo(), 'image/jpeg', controller.signal);
    const caught = pending.catch((error) => error);
    await tick();
    expect(decode).toHaveBeenCalledTimes(1);
    controller.abort();
    const second = convertHeic(photo({ name: 'next.heif' }), 'image/png');
    await tick();
    expect(decode).toHaveBeenCalledTimes(1);
    first.resolve(stale);
    expect(await caught).toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({
      filename: 'next-converted.png',
      width: 200,
      height: 100,
    });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(next.close).toHaveBeenCalledTimes(1);
  });
});
