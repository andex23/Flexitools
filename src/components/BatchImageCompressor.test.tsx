import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEventBase from '@testing-library/user-event';
import BatchImageCompressor from './BatchImageCompressor';
import { compressImage, ImageCompressionResult } from '../utils/imageCompression';

jest.mock('../utils/imageCompression', () => ({ ...jest.requireActual('../utils/imageCompression'), compressImage: jest.fn() }));
const mockCompressImage = compressImage as jest.MockedFunction<typeof compressImage>;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
function result(size = 500, extra: Partial<ImageCompressionResult> = {}): ImageCompressionResult {
  return { blob: new Blob([new Uint8Array(size)], { type: 'image/webp' }), originalWidth: 40, originalHeight: 30, width: 40, height: 30, keptOriginal: false, ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function chooseFiles(names = ['first.png', 'second.png'], replace = false) {
  const files = names.map(name => new File([new Uint8Array(1000)], name, { type: 'image/png' }));
  // eslint-disable-next-line testing-library/no-unnecessary-act -- user-event v13 does not wrap React 18 updates.
  await act(async () => { userEventBase.upload(screen.getByLabelText(replace ? 'Replace image batch' : 'Choose image batch'), files); });
  await screen.findByText(`${files.length} ${files.length === 1 ? 'image' : 'images'} selected`);
}
beforeEach(() => {
  mockCompressImage.mockReset();
  let next = 0;
  URL.createObjectURL = jest.fn(() => `blob:batch-${++next}`);
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

it('shows actual results, preserves failures, and creates a downloadable ZIP of successes', async () => {
  mockCompressImage.mockResolvedValueOnce(result(1500, { warning: 'This format produced a larger image.' })).mockRejectedValueOnce(new Error('Animated images are not supported.'));
  const { unmount } = render(<BatchImageCompressor />);
  await chooseFiles();
  fireEvent.click(screen.getByRole('button', { name: 'Compress batch' }));
  await screen.findByText('1 image ready');
  expect(await screen.findByRole('link', { name: 'Download first-optimized.webp' })).toHaveAttribute('download', 'first-optimized.webp');
  expect(screen.getByText('Animated images are not supported.')).toBeInTheDocument();
  expect(screen.getByText('This format produced a larger image.')).toBeInTheDocument();
  expect(screen.queryByText(/% smaller/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create ZIP of 1 image' }));
  const zip = await screen.findByRole('link', { name: /Download ZIP/ });
  expect(zip).toHaveAttribute('download', 'flexitool-images.zip');
  const zipUrl = zip.getAttribute('href');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(zipUrl);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:batch-1');
});

it('invalidates both image and ZIP downloads when output settings change', async () => {
  mockCompressImage.mockResolvedValue(result());
  render(<BatchImageCompressor />);
  await chooseFiles(['first.png']);
  fireEvent.click(screen.getByRole('button', { name: 'Compress batch' }));
  await screen.findByRole('link', { name: 'Download first-optimized.webp' });
  fireEvent.click(screen.getByRole('button', { name: 'Create ZIP of 1 image' }));
  await screen.findByRole('link', { name: /Download ZIP/ });
  fireEvent.change(screen.getByLabelText('Batch output format'), { target: { value: 'image/jpeg' } });
  await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:batch-1');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:batch-2');
  expect(screen.getByRole('button', { name: 'Compress batch' })).toBeEnabled();
});

it('retains completed downloads on cancellation and ignores late results after a replacement', async () => {
  const late = deferred<ImageCompressionResult>();
  mockCompressImage.mockResolvedValueOnce(result()).mockReturnValueOnce(late.promise);
  render(<BatchImageCompressor />);
  await chooseFiles();
  fireEvent.click(screen.getByRole('button', { name: 'Compress batch' }));
  await screen.findByRole('link', { name: 'Download first-optimized.webp' });
  const signal = mockCompressImage.mock.calls[1][2]!;
  expect(screen.getByLabelText('Batch output format')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel batch' }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('link', { name: 'Download first-optimized.webp' })).toBeInTheDocument();
  await chooseFiles(['replacement.png'], true);
  await act(async () => { late.resolve(result(10)); await late.promise; });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText('second.png')).not.toBeInTheDocument();
  expect(screen.getByText('replacement.png')).toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:batch-1');
});

it('aborts the queue on unmount', async () => {
  mockCompressImage.mockReturnValue(new Promise(() => {}));
  const { unmount } = render(<BatchImageCompressor />);
  await chooseFiles();
  fireEvent.click(screen.getByRole('button', { name: 'Compress batch' }));
  const signal = mockCompressImage.mock.calls[0][2]!;
  unmount();
  expect(signal.aborted).toBe(true);
  expect(mockCompressImage).toHaveBeenCalledTimes(1);
});
