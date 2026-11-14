import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaUpload from './MediaUpload';

it('passes a selected supported file through the real dropzone', async () => {
  const onSelect = jest.fn();
  const file = new File(['test-image'], 'example.webp', { type: 'image/webp' });
  render(<MediaUpload kind="image" onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText('Choose image file'), { target: { files: [file] } });
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(file));
});

it('rejects unsupported and excessive files with a visible explanation', async () => {
  const onSelect = jest.fn();
  const { rerender } = render(<MediaUpload kind="image" onSelect={onSelect} />);
  fireEvent.change(screen.getByLabelText('Choose image file'), { target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose one supported image file.');
  rerender(<MediaUpload kind="image" onSelect={onSelect} maxBytes={1} />);
  fireEvent.change(screen.getByLabelText('Choose image file'), { target: { files: [new File(['large'], 'photo.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Choose a file smaller than'));
  expect(onSelect).not.toHaveBeenCalled();
});
