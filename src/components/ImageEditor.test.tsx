import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageEditor from './ImageEditor';
import { editImage, ImageEditResult, inspectImageForEditing } from '../utils/imageEditing';

jest.mock('../utils/imageEditing', () => ({
  ...jest.requireActual('../utils/imageEditing'),
  inspectImageForEditing: jest.fn(),
  editImage: jest.fn(),
}));

const file = () => new File(['image'], 'holiday.jpg', { type: 'image/jpeg' });
const output = (): ImageEditResult => ({ blob: new Blob(['output'], { type: 'image/png' }), width: 300, height: 500, originalWidth: 800, originalHeight: 600, warning: 'Source metadata is not copied.' });
const originalCreateURL = URL.createObjectURL;
const originalRevokeURL = URL.revokeObjectURL;

beforeEach(() => {
  jest.clearAllMocks();
  let count = 0;
  URL.createObjectURL = jest.fn(() => `blob:editor-${++count}`);
  URL.revokeObjectURL = jest.fn();
  jest.mocked(inspectImageForEditing).mockResolvedValue({ width: 800, height: 600 });
  jest.mocked(editImage).mockResolvedValue(output());
});

afterEach(() => {
  URL.createObjectURL = originalCreateURL;
  URL.revokeObjectURL = originalRevokeURL;
});

async function selectImage() {
  fireEvent.change(screen.getByLabelText('Choose image file'), { target: { files: [file()] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply edits & preview' })).toBeEnabled());
}

it('previews the selected crop and rotation only on request and clears outdated downloads', async () => {
  const { unmount } = render(<ImageEditor />);
  await selectImage();
  fireEvent.change(screen.getByLabelText('Left (px)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Crop width (px)'), { target: { value: '500' } });
  fireEvent.change(screen.getByLabelText('Crop height (px)'), { target: { value: '300' } });
  fireEvent.change(screen.getByLabelText('Rotation'), { target: { value: '90' } });
  expect(editImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply edits & preview' }));
  const download = await screen.findByRole('link', { name: /Download edited image/ });
  expect(editImage).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ mode: 'edit', crop: { x: 100, y: 0, width: 500, height: 300 }, rotation: 90 }), expect.any(AbortSignal));
  expect(screen.getByAltText('Edited result showing crop, rotation, and watermark')).toHaveAttribute('src', 'blob:editor-2');
  expect(download).toHaveAttribute('download', 'holiday-edited.png');
  fireEvent.change(screen.getByLabelText('Crop width (px)'), { target: { value: '400' } });
  expect(screen.queryByRole('link', { name: /Download edited image/ })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-2');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-1');
});

it('provides an explicit metadata operation that excludes crop and watermark settings', async () => {
  render(<ImageEditor />);
  await selectImage();
  fireEvent.change(screen.getByLabelText('Text watermark (optional)'), { target: { value: 'Hidden setting' } });
  fireEvent.change(screen.getByLabelText('Crop width (px)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Tool'), { target: { value: 'metadata' } });
  expect(screen.queryByLabelText('Crop width (px)')).not.toBeInTheDocument();
  expect(screen.getByText(/Color profiles may also be removed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove metadata & preview' }));
  const download = await screen.findByRole('link', { name: /Download cleaned copy/ });
  expect(editImage).toHaveBeenCalledWith(expect.any(File), { mode: 'metadata', format: 'image/png' }, expect.any(AbortSignal));
  expect(download).toHaveAttribute('download', 'holiday-metadata-removed.png');
});

it('cancels editing without showing a late output', async () => {
  let finish!: (value: ImageEditResult) => void;
  jest.mocked(editImage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ImageEditor />);
  await selectImage();
  fireEvent.click(screen.getByRole('button', { name: 'Apply edits & preview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(jest.mocked(editImage).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => { finish(output()); });
  expect(screen.queryByRole('link', { name: /Download edited image/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply edits & preview' })).toBeEnabled();
});

it('does not let an old file check overwrite a replacement image', async () => {
  let finish!: (value: { width: number; height: number }) => void;
  jest.mocked(inspectImageForEditing).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ImageEditor />);
  fireEvent.change(screen.getByLabelText('Choose image file'), { target: { files: [file()] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Remove image' }));
  await selectImage();
  await act(async () => { finish({ width: 100, height: 100 }); });
  expect(screen.getByLabelText('Crop width (px)')).toHaveValue(800);
  expect(screen.getByLabelText('Crop height (px)')).toHaveValue(600);
});
