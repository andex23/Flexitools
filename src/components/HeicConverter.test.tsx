import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HeicConverter from './HeicConverter';
import { convertHeic, HeicResult } from '../utils/heicConversion';

jest.mock('../utils/heicConversion', () => ({
  ...jest.requireActual('../utils/heicConversion'),
  convertHeic: jest.fn(),
}));
const convert = convertHeic as jest.MockedFunction<typeof convertHeic>;
const result: HeicResult = {
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  width: 400,
  height: 300,
  filename: 'photo-converted.jpg',
};
function deferred() {
  let resolve!: (value: HeicResult) => void;
  const promise = new Promise<HeicResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function choosePhoto() {
  fireEvent.change(screen.getByLabelText(/Choose a HEIC or HEIF still photo/), {
    target: { files: [new File(['test'], 'photo.heic')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Convert HEIC' }));
}
beforeEach(() => {
  convert.mockReset();
  URL.createObjectURL = jest.fn(() => 'blob:converted');
  URL.revokeObjectURL = jest.fn();
});

it('downloads the converted file and removes a stale preview when format changes', async () => {
  convert.mockResolvedValue(result);
  render(<HeicConverter />);
  choosePhoto();
  const download = await screen.findByRole('link', { name: 'Download JPG' });
  expect(download).toHaveAttribute('download', 'photo-converted.jpg');
  expect(download).toHaveAttribute('href', 'blob:converted');
  fireEvent.change(screen.getByRole('combobox'), {
    target: { value: 'image/png' },
  });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:converted');
});

it('waits for the active decoder after cancellation and suppresses its stale result', async () => {
  const pending = deferred();
  convert.mockReturnValue(pending.promise);
  render(<HeicConverter />);
  choosePhoto();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel conversion' }));
  expect(convert.mock.calls[0][2]?.aborted).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Cancelling after the current decode finishes',
  );
  expect(screen.getByRole('button', { name: 'Converting…' })).toBeDisabled();
  await act(async () => {
    pending.resolve(result);
    await pending.promise;
  });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Convert HEIC' })).toBeEnabled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('aborts on unmount and does not create an object URL for a late result', async () => {
  const pending = deferred();
  convert.mockReturnValue(pending.promise);
  const view = render(<HeicConverter />);
  choosePhoto();
  view.unmount();
  expect(convert.mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(result);
    await pending.promise;
  });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
