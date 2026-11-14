import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VideoCompressor from './VideoCompressor';
import {
  deleteVideoJob, getVideoJob, getVideoService, uploadVideo, VideoJob,
  VideoJobIdentity, VideoRequestError,
} from '../utils/videoClient';

jest.mock('../utils/videoClient', () => ({
  ...jest.requireActual('../utils/videoClient'),
  getVideoService: jest.fn(),
  uploadVideo: jest.fn(),
  getVideoJob: jest.fn(),
  deleteVideoJob: jest.fn(),
}));

const serviceMock = getVideoService as jest.MockedFunction<typeof getVideoService>;
const uploadMock = uploadVideo as jest.MockedFunction<typeof uploadVideo>;
const statusMock = getVideoJob as jest.MockedFunction<typeof getVideoJob>;
const deleteMock = deleteVideoJob as jest.MockedFunction<typeof deleteVideoJob>;
const identity = { id: 'test-job', token: 'private-test-token' };
const complete: VideoJob = {
  id: identity.id, status: 'completed', progress: 100, filename: 'movie-compressed.mp4',
  inputBytes: 2048, outputBytes: 1024, width: 1920, height: 1080, duration: 8,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function chooseVideo() {
  await screen.findByRole('button', { name: 'Compress video' });
  const file = new File([new Uint8Array(2048)], 'movie.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Choose video file'), { target: { files: [file] } });
  await screen.findByText('movie.mp4');
  return file;
}

async function startVideo() {
  const file = await chooseVideo();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to upload this video for processing.' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compress video' })); });
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
  return file;
}

beforeEach(() => {
  jest.clearAllMocks();
  serviceMock.mockResolvedValue({ available: true, maxFileBytes: 10 * 1024 ** 3, retentionMinutes: 7 });
  deleteMock.mockResolvedValue(undefined);
  uploadMock.mockImplementation(() => new Promise(() => undefined));
  statusMock.mockImplementation(() => new Promise(() => undefined));
  URL.createObjectURL = jest.fn(() => 'blob:local-video');
  URL.revokeObjectURL = jest.fn();
});

test('requires explicit consent before sending a selected video to the server', async () => {
  render(<VideoCompressor />);
  const file = await chooseVideo();
  expect(uploadMock).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Compress video' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to upload this video for processing.' }));
  expect(screen.getByRole('button', { name: 'Compress video' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compress video' })); });
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
  expect(uploadMock.mock.calls[0][0]).toBe(file);
  expect(uploadMock.mock.calls[0][1]).toEqual({ preset: 'quality', maxHeight: 0, targetMB: undefined });
});

test('rejects invalid targets and makes target sizing mutually exclusive with quality presets', async () => {
  render(<VideoCompressor />);
  await chooseVideo();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to upload this video for processing.' }));
  const target = screen.getByRole('spinbutton', { name: /Target file size/ });
  for (const value of ['0', '-1', '1.5', '10241']) {
    fireEvent.change(target, { target: { value } });
    expect(screen.getByRole('button', { name: 'Compress video' })).toBeDisabled();
    expect(target).toHaveAttribute('aria-invalid', 'true');
  }
  fireEvent.change(target, { target: { value: '50' } });
  expect(screen.getByRole('button', { name: 'Compress video' })).toBeEnabled();
  expect(screen.getByRole('radio', { name: /Balanced/ })).toBeDisabled();
  fireEvent.change(target, { target: { value: '' } });
  expect(screen.getByRole('radio', { name: /Balanced/ })).toBeEnabled();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('aborts an upload and cleans up a job if its response arrives after cancellation', async () => {
  const upload = deferred<VideoJobIdentity>();
  uploadMock.mockReturnValue(upload.promise);
  render(<VideoCompressor />);
  await startVideo();
  const signal = uploadMock.mock.calls[0][3];
  fireEvent.click(screen.getByRole('button', { name: 'Cancel processing' }));
  expect(signal?.aborted).toBe(true);
  expect(await screen.findByText(/Upload cancelled\. Any temporary server files/)).toBeInTheDocument();
  expect(screen.queryByText('Server files deleted. Your original is unchanged.')).not.toBeInTheDocument();
  await act(async () => { upload.resolve(identity); });
  await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(identity));
  expect(statusMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Download MP4' })).not.toBeInTheDocument();
});

test('cleans up a late accepted upload after the workspace unmounts', async () => {
  const upload = deferred<VideoJobIdentity>();
  uploadMock.mockReturnValue(upload.promise);
  const view = render(<VideoCompressor />);
  await startVideo();
  const signal = uploadMock.mock.calls[0][3];
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { upload.resolve(identity); });
  expect(deleteMock).toHaveBeenCalledWith(identity);
  expect(statusMock).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-video');
});

test('ignores an in-flight completion response after the user cancels processing', async () => {
  const status = deferred<VideoJob>();
  uploadMock.mockResolvedValue(identity);
  statusMock.mockReturnValue(status.promise);
  render(<VideoCompressor />);
  await startVideo();
  await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel processing' }));
  await screen.findByText('Server files deleted. Your original is unchanged.');
  await act(async () => { status.resolve(complete); });
  expect(screen.queryByRole('link', { name: 'Download MP4' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Compress video' })).toBeEnabled();
});

test('shows server retention and measured savings, and only confirms deletion after it succeeds', async () => {
  uploadMock.mockResolvedValue(identity);
  statusMock.mockResolvedValue(complete);
  render(<VideoCompressor />);
  await startVideo();
  expect(await screen.findByRole('link', { name: 'Download MP4' })).toHaveAttribute('href', '/api/jobs/test-job/download?token=private-test-token');
  expect(screen.getByText('50% smaller')).toBeInTheDocument();
  expect(screen.getByText(/Available for up to 7 minutes after processing/)).toBeInTheDocument();
  const deletion = deferred<void>();
  deleteMock.mockReturnValueOnce(deletion.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Delete server files' }));
  expect(screen.queryByText('Server files deleted. Your original is unchanged.')).not.toBeInTheDocument();
  await act(async () => { deletion.reject(new Error('Network offline')); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm deletion');
  fireEvent.click(screen.getByRole('button', { name: 'Delete server files' }));
  expect(await screen.findByText('Server files deleted. Your original is unchanged.')).toBeInTheDocument();
});

test('allows a new job after the server has expired the old capability', async () => {
  uploadMock.mockResolvedValue(identity);
  statusMock.mockRejectedValueOnce(new VideoRequestError('Job unavailable', 403)).mockResolvedValue(complete);
  render(<VideoCompressor />);
  await startVideo();
  expect(await screen.findByRole('alert')).toHaveTextContent('expired or is no longer available');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Compress video' })); });
  await screen.findByRole('link', { name: 'Download MP4' });
  expect(uploadMock).toHaveBeenCalledTimes(2);
  // An expired capability must not prevent the next upload through a failing DELETE.
  expect(deleteMock).not.toHaveBeenCalled();
});

test('does not upload while the hosted service is unavailable', async () => {
  serviceMock.mockResolvedValue({ available: false, maxFileBytes: 10 * 1024 ** 3, retentionMinutes: 7 });
  render(<VideoCompressor />);
  await chooseVideo();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to upload this video for processing.' }));
  expect(screen.getByRole('button', { name: 'Compress video' })).toBeDisabled();
  expect(uploadMock).not.toHaveBeenCalled();
});
