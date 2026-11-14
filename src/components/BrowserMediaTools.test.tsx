import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BrowserMediaTools from './BrowserMediaTools';
import {
  BROWSER_VIDEO_INPUT_LIMIT,
  BrowserVideoMetadata,
  BrowserVideoResult,
  convertBrowserVideo,
  getBrowserVideoCapabilities,
  inspectBrowserVideo,
} from '../utils/browserVideo';

jest.mock('../utils/browserVideo', () => ({
  BROWSER_VIDEO_INPUT_LIMIT: 500 * 1024 ** 2,
  BROWSER_VIDEO_OUTPUT_LIMIT: 256 * 1024 ** 2,
  BROWSER_VIDEO_DISK_INPUT_LIMIT: 4 * 1024 ** 3,
  getBrowserVideoCapabilities: jest.fn(),
  inspectBrowserVideo: jest.fn(),
  convertBrowserVideo: jest.fn(),
}));

const capabilitiesMock = getBrowserVideoCapabilities as jest.MockedFunction<typeof getBrowserVideoCapabilities>;
const inspectMock = inspectBrowserVideo as jest.MockedFunction<typeof inspectBrowserVideo>;
const convertMock = convertBrowserVideo as jest.MockedFunction<typeof convertBrowserVideo>;
const pickerWindow = window as unknown as { showSaveFilePicker?: jest.Mock };
const metadata: BrowserVideoMetadata = { duration: 12, width: 1920, height: 1080, hasAudio: true };
const completed: BrowserVideoResult = {
  filename: 'movie-compressed.mp4', mimeType: 'video/mp4', outputBytes: 1024,
  blob: new Blob([new Uint8Array(1024)], { type: 'video/mp4' }),
  savedToDisk: false, duration: 12, width: 1920, height: 1080,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function chooseVideo(file = new File([new Uint8Array(2048)], 'movie.mp4', { type: 'video/mp4' })) {
  await waitFor(() => expect(screen.queryByText('Checking this browser’s media support…')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Choose video file'), { target: { files: [file] } });
  await screen.findByText(file.name);
  return file;
}

async function startVideo() {
  const file = await chooseVideo();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Process video' })).toBeEnabled());
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Process video' })); });
  await waitFor(() => expect(convertMock).toHaveBeenCalledTimes(1));
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete pickerWindow.showSaveFilePicker;
  capabilitiesMock.mockResolvedValue({ supported: true, videoFormats: ['mp4', 'webm'], audioFormats: ['m4a', 'ogg', 'wav'], canSaveToDisk: false });
  inspectMock.mockResolvedValue(metadata);
  convertMock.mockImplementation(() => new Promise(() => undefined));
  URL.createObjectURL = jest.fn((blob: Blob) => blob instanceof File ? 'blob:original' : 'blob:result');
  URL.revokeObjectURL = jest.fn();
});

test('waits for metadata and processes locally with no upload consent or target-size promise', async () => {
  const reading = deferred<BrowserVideoMetadata>();
  inspectMock.mockReturnValueOnce(reading.promise);
  render(<BrowserMediaTools />);
  const file = await chooseVideo();
  expect(screen.getByRole('button', { name: 'Process video' })).toBeDisabled();
  expect(screen.getByText('Files stay on your device. No uploads, account, or payment.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /agree to upload/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('spinbutton', { name: /Target file size/i })).not.toBeInTheDocument();
  await act(async () => { reading.resolve(metadata); });
  fireEvent.click(screen.getByRole('button', { name: 'Process video' }));
  expect(convertMock).toHaveBeenCalledWith(file, {
    operation: 'video', format: 'mp4', preset: 'quality', maxHeight: 0,
    trimStart: 0, trimEnd: 12, mute: false,
  }, expect.objectContaining({ signal: expect.any(AbortSignal), saveToDisk: undefined }));
});

test('passes trim, resize, mute, and quality choices and rejects invalid trim ranges', async () => {
  render(<BrowserMediaTools />);
  await chooseVideo();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Process video' })).toBeEnabled());
  const start = screen.getByRole('spinbutton', { name: 'Start time (seconds)' });
  const end = screen.getByRole('spinbutton', { name: /End time/ });
  for (const value of ['-1', '12', '13']) {
    fireEvent.change(start, { target: { value } });
    expect(screen.getByRole('button', { name: 'Process video' })).toBeDisabled();
  }
  fireEvent.change(start, { target: { value: '2' } });
  fireEvent.change(end, { target: { value: '13' } });
  expect(end).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Process video' })).toBeDisabled();
  fireEvent.change(end, { target: { value: '9.5' } });
  fireEvent.change(screen.getByRole('combobox', { name: /Maximum resolution/ }), { target: { value: '720' } });
  fireEvent.click(screen.getByRole('radio', { name: /Balanced/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remove audio from video' }));
  fireEvent.click(screen.getByRole('button', { name: 'Process video' }));
  expect(convertMock.mock.calls[0][1]).toEqual({ operation: 'video', format: 'mp4', preset: 'balanced', maxHeight: 720, trimStart: 2, trimEnd: 9.5, mute: true });
});

test('shows unsupported browser guidance and does not enable encoding', async () => {
  capabilitiesMock.mockResolvedValue({ supported: false, videoFormats: [], audioFormats: [], canSaveToDisk: false, reason: 'No supported media codecs.' });
  render(<BrowserMediaTools />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No supported media codecs.');
  expect(screen.getByRole('button', { name: 'Process video' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Extract audio' })).toBeDisabled();
  expect(convertMock).not.toHaveBeenCalled();
});

test('offers only available formats and prevents extraction from silent video', async () => {
  capabilitiesMock.mockResolvedValue({ supported: true, videoFormats: ['webm'], audioFormats: ['ogg'], canSaveToDisk: false });
  inspectMock.mockResolvedValue({ ...metadata, hasAudio: false });
  render(<BrowserMediaTools />);
  await chooseVideo();
  expect(screen.getByRole('option', { name: 'WEBM' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'MP4' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Extract audio' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no audio track');
  expect(screen.getByRole('option', { name: 'OGG' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Extract audio file' })).toBeDisabled();
});

test('exports extracted audio without describing removal of video as compression savings', async () => {
  convertMock.mockResolvedValue({ ...completed, filename: 'movie-audio.m4a', mimeType: 'audio/mp4', width: undefined, height: undefined });
  render(<BrowserMediaTools />);
  await chooseVideo();
  fireEvent.click(screen.getByRole('button', { name: 'Extract audio' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Extract audio file' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Extract audio file' }));
  expect(await screen.findByRole('link', { name: 'Download M4A' })).toHaveAttribute('download', 'movie-audio.m4a');
  expect(convertMock.mock.calls[0][1]).toMatchObject({ operation: 'audio', format: 'm4a', mute: false });
  expect(screen.queryByText('50% smaller')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Extracted audio preview')).toBeInTheDocument();
});

test('reports actual output sizes and clears obsolete results when settings change', async () => {
  convertMock.mockResolvedValue(completed);
  render(<BrowserMediaTools />);
  await startVideo();
  expect(await screen.findByRole('link', { name: 'Download MP4' })).toHaveAttribute('href', 'blob:result');
  expect(screen.getByText('50% smaller')).toBeInTheDocument();
  expect(screen.getByText('1 KB')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: /Maximum resolution/ }), { target: { value: '720' } });
  expect(screen.queryByRole('link', { name: 'Download MP4' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result');
});

test('does not claim savings when the processed video is larger', async () => {
  convertMock.mockResolvedValue({ ...completed, outputBytes: 4096 });
  render(<BrowserMediaTools />);
  await startVideo();
  expect(await screen.findByText(/The output is not smaller/)).toBeInTheDocument();
  expect(screen.getByText('4 KB')).toBeInTheDocument();
  expect(screen.queryByText(/% smaller/)).not.toBeInTheDocument();
});

test('cancels encoding, ignores late progress and results, and allows a retry', async () => {
  const converting = deferred<BrowserVideoResult>();
  convertMock.mockReturnValueOnce(converting.promise);
  render(<BrowserMediaTools />);
  await startVideo();
  const options = convertMock.mock.calls[0][2]!;
  act(() => { options.onProgress?.(0.42); });
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel processing' }));
  expect(options.signal?.aborted).toBe(true);
  await act(async () => { options.onProgress?.(1); converting.resolve(completed); });
  expect(screen.queryByRole('link', { name: 'Download MP4' })).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Process video' })).toBeEnabled();
  expect(screen.getByRole('status')).toHaveTextContent('Processing cancelled');
});

test('ignores stale source metadata after changing files', async () => {
  const oldReading = deferred<BrowserVideoMetadata>();
  inspectMock.mockReturnValueOnce(oldReading.promise);
  render(<BrowserMediaTools />);
  await chooseVideo();
  const oldSignal = inspectMock.mock.calls[0][1];
  fireEvent.click(screen.getByRole('button', { name: 'Change file' }));
  expect(oldSignal?.aborted).toBe(true);
  const next = new File([new Uint8Array(4096)], 'next.webm', { type: 'video/webm' });
  await chooseVideo(next);
  await act(async () => { oldReading.resolve({ ...metadata, duration: 999 }); });
  expect(screen.queryByText(/999 seconds/)).not.toBeInTheDocument();
  expect(screen.getByText(/12 seconds/)).toBeInTheDocument();
});

test('opens the save picker from the click and passes the writable to the engine for a large input', async () => {
  const writable = { write: jest.fn(), close: jest.fn(), abort: jest.fn().mockResolvedValue(undefined) };
  const createWritable = jest.fn().mockResolvedValue(writable);
  pickerWindow.showSaveFilePicker = jest.fn().mockResolvedValue({ name: 'my-short-video.mp4', createWritable });
  capabilitiesMock.mockResolvedValue({ supported: true, videoFormats: ['mp4'], audioFormats: ['m4a'], canSaveToDisk: true });
  convertMock.mockResolvedValue({ ...completed, blob: undefined, savedToDisk: true });
  render(<BrowserMediaTools />);
  const large = new File([new Uint8Array(1)], 'large.mp4', { type: 'video/mp4' });
  Object.defineProperty(large, 'size', { value: BROWSER_VIDEO_INPUT_LIMIT + 1 });
  await chooseVideo(large);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Process video' })).toBeEnabled());
  expect(screen.getByRole('checkbox', { name: 'Save directly to a file' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Save directly to a file' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Process video' }));
  expect(pickerWindow.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'large-compressed.mp4' }));
  expect(await screen.findByText('Saved to your device')).toBeInTheDocument();
  expect(screen.getByText(/my-short-video.mp4 is saved/)).toBeInTheDocument();
  expect(createWritable).toHaveBeenCalledWith({ keepExistingData: false });
  expect(convertMock.mock.calls[0][2]?.saveToDisk).toBe(writable);
  expect(screen.queryByRole('link', { name: 'Download MP4' })).not.toBeInTheDocument();
  expect(writable.close).not.toHaveBeenCalled(); // The engine owns commit/abort after handoff.
});

test('cancelling the save picker does not start processing', async () => {
  pickerWindow.showSaveFilePicker = jest.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  capabilitiesMock.mockResolvedValue({ supported: true, videoFormats: ['mp4'], audioFormats: ['m4a'], canSaveToDisk: true });
  render(<BrowserMediaTools />);
  await chooseVideo();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Save directly to a file' }));
  fireEvent.click(screen.getByRole('button', { name: 'Process video' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Save cancelled');
  expect(convertMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Process video' })).toBeEnabled();
});

test('aborts a writable that finishes opening after the user cancels', async () => {
  const opening = deferred<{ write: jest.Mock; close: jest.Mock; abort: jest.Mock }>();
  const writable = { write: jest.fn(), close: jest.fn(), abort: jest.fn().mockResolvedValue(undefined) };
  const createWritable = jest.fn().mockReturnValue(opening.promise);
  pickerWindow.showSaveFilePicker = jest.fn().mockResolvedValue({ createWritable });
  capabilitiesMock.mockResolvedValue({ supported: true, videoFormats: ['mp4'], audioFormats: ['m4a'], canSaveToDisk: true });
  render(<BrowserMediaTools />);
  await chooseVideo();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Save directly to a file' }));
  fireEvent.click(screen.getByRole('button', { name: 'Process video' }));
  await waitFor(() => expect(createWritable).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel processing' }));
  await act(async () => { opening.resolve(writable); });
  expect(writable.abort).toHaveBeenCalledTimes(1);
  expect(convertMock).not.toHaveBeenCalled();
});

test('unmounting aborts conversion and revokes the original preview', async () => {
  const converting = deferred<BrowserVideoResult>();
  convertMock.mockReturnValueOnce(converting.promise);
  const view = render(<BrowserMediaTools />);
  await startVideo();
  const signal = convertMock.mock.calls[0][2]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original');
  await act(async () => { converting.resolve(completed); });
  expect(URL.createObjectURL).not.toHaveBeenCalledWith(completed.blob);
});
