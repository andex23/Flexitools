import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEventBase from '@testing-library/user-event';
import ImageCompressor from './ImageCompressor';
import { compressImage, ImageCompressionResult } from '../utils/imageCompression';

jest.mock('../utils/imageCompression', () => ({
  ...jest.requireActual('../utils/imageCompression'),
  compressImage: jest.fn(),
}));

const mockCompressImage = compressImage as jest.MockedFunction<typeof compressImage>;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
// user-event v13 does not consistently wrap React 18 updates in act.
const userEvent = {
  click: (element: Element) => act(() => userEventBase.click(element)),
  selectOptions: (element: HTMLElement, value: string) => act(() => userEventBase.selectOptions(element, value)),
  upload: (element: HTMLElement, file: File) => act(async () => { userEventBase.upload(element, file); }),
};

function result(size = 1000, extra: Partial<ImageCompressionResult> = {}): ImageCompressionResult {
  return {
    blob: new Blob([new Uint8Array(size)], { type: 'image/webp' }),
    originalWidth: 1600, originalHeight: 1200,
    width: 1600, height: 1200, keptOriginal: false,
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function chooseFile(name = 'photo.png') {
  const file = new File([new Uint8Array(2000)], name, { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('Choose image file'), file);
  await screen.findByText(name);
  return file;
}

beforeEach(() => {
  mockCompressImage.mockReset();
  let urlNumber = 0;
  URL.createObjectURL = jest.fn(() => `blob:preview-${++urlNumber}`);
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('image compression flow', () => {
  it.each(['preset', 'format', 'dimensions', 'target'])('invalidates a previous download when %s changes', async setting => {
    mockCompressImage.mockResolvedValue(result());
    render(<ImageCompressor />);
    await chooseFile();
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const download = await screen.findByRole('link', { name: /Download image/ });
    const previousOutputUrl = download.getAttribute('href');
    expect(screen.getByText('50% smaller. Ready to go.')).toBeInTheDocument();

    if (setting === 'preset') userEvent.click(screen.getByRole('radio', { name: /Balanced/ }));
    if (setting === 'format') userEvent.selectOptions(screen.getByLabelText('Output format'), 'image/jpeg');
    if (setting === 'dimensions') userEvent.selectOptions(screen.getByLabelText(/Image dimensions/), '1280');
    if (setting === 'target') {
      userEvent.click(screen.getByText('Have a file size in mind?'));
      fireEvent.change(screen.getByLabelText(/Target file size/), { target: { value: '1' } });
    }

    expect(screen.queryByRole('link', { name: /Download image/ })).not.toBeInTheDocument();
    expect(screen.queryByText('50% smaller. Ready to go.')).not.toBeInTheDocument();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(previousOutputUrl));
    expect(screen.getByRole('button', { name: 'Compress image' })).toBeEnabled();
  });

  it('shows actual sizes and a warning when conversion creates a larger file', async () => {
    mockCompressImage.mockResolvedValue(result(3000, { warning: 'These dimensions or this format produced a larger file. Try WebP or a smaller size.' }));
    render(<ImageCompressor />);
    await chooseFile();
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const download = await screen.findByRole('link', { name: /Download image/ });
    expect(screen.getByRole('heading', { name: 'Your image is ready.' })).toBeInTheDocument();
    expect(screen.queryByText(/% smaller/)).not.toBeInTheDocument();
    expect(screen.getByText(/produced a larger file/)).toBeInTheDocument();
    expect(download).toHaveTextContent('2.93 KB');
    expect(download).toHaveAttribute('download', 'photo-optimized.webp');
  });

  it('labels a kept original honestly and uses its original format extension', async () => {
    mockCompressImage.mockResolvedValue(result(2000, {
      blob: new Blob([new Uint8Array(2000)], { type: 'image/png' }), keptOriginal: true,
      warning: 'This image is already smaller than the processed result. Your original is kept.',
    }));
    render(<ImageCompressor />);
    await chooseFile();
    userEvent.selectOptions(screen.getByLabelText('Output format'), 'image/png');
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const download = await screen.findByRole('link', { name: /Download original/ });
    expect(download).toHaveAttribute('download', 'photo-original.png');
    expect(screen.getByText('ORIGINAL KEPT')).toBeInTheDocument();
    expect(screen.queryByText(/% smaller/)).not.toBeInTheDocument();
  });

  it('aborts on cancel and ignores a late result after selecting a new file', async () => {
    const first = deferred<ImageCompressionResult>();
    const second = deferred<ImageCompressionResult>();
    mockCompressImage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ImageCompressor />);
    await chooseFile('first.png');
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const firstSignal = mockCompressImage.mock.calls[0][2]!;
    expect(firstSignal.aborted).toBe(false);
    expect(screen.getByLabelText('Output format')).toBeDisabled();
    userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(firstSignal.aborted).toBe(true);
    userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    await chooseFile('second.png');
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const secondSignal = mockCompressImage.mock.calls[1][2]!;

    await act(async () => { first.resolve(result(200)); await first.promise; });
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compressing…' })).toBeDisabled();
    expect(secondSignal.aborted).toBe(false);

    await act(async () => { second.resolve(result(800)); await second.promise; });
    expect(await screen.findByRole('link', { name: /Download image/ })).toHaveAttribute('download', 'second-optimized.webp');
    expect(screen.getByText('60% smaller. Ready to go.')).toBeInTheDocument();
    expect(screen.queryByText('90% smaller. Ready to go.')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  it('aborts pending processing and releases the original preview on unmount', async () => {
    mockCompressImage.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<ImageCompressor />);
    await chooseFile();
    userEvent.click(screen.getByRole('button', { name: 'Compress image' }));
    const signal = mockCompressImage.mock.calls[0][2]!;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
});
