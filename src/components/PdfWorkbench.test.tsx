import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfWorkbench from './PdfWorkbench';
import { inspectPdf, mergePdfPages, PdfResult } from '../utils/pdfTools';

jest.mock('../utils/pdfTools', () => ({
  ...jest.requireActual('../utils/pdfTools'),
  inspectPdf: jest.fn(),
  mergePdfPages: jest.fn(),
  splitPdfPages: jest.fn(),
}));
const inspect = inspectPdf as jest.MockedFunction<typeof inspectPdf>;
const merge = mergePdfPages as jest.MockedFunction<typeof mergePdfPages>;
const output: PdfResult = { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'combined.pdf', pageCount: 2 };
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

async function addFile(name = 'first.pdf') {
  const file = new File(['pdf'], name, { type: 'application/pdf' });
  await act(async () => { fireEvent.change(screen.getByLabelText('Add PDF files'), { target: { files: [file] } }); });
  await screen.findByLabelText(`Pages from ${name}`);
  return file;
}

beforeEach(() => {
  inspect.mockReset().mockResolvedValue({ pageCount: 3 });
  merge.mockReset().mockResolvedValue(output);
  URL.createObjectURL = jest.fn(() => 'blob:pdf-test');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

it('passes document and page order to export and invalidates old downloads when options change', async () => {
  render(<PdfWorkbench/>);
  const first = await addFile();
  const second = await addFile('second.pdf');
  fireEvent.change(screen.getByLabelText('Pages from first.pdf'), { target: { value: '3,1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move second.pdf up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create PDF' }));
  await screen.findByRole('link', { name: 'Download PDF' });
  expect(merge.mock.calls[0][0]).toEqual([{ file: second, pages: 'all' }, { file: first, pages: '3,1' }]);
  fireEvent.change(screen.getByLabelText('Pages from first.pdf'), { target: { value: '2' } });
  expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-test');
});

it('blocks invalid ranges and explains why splitting multiple PDFs is unavailable', async () => {
  render(<PdfWorkbench/>);
  await addFile();
  fireEvent.change(screen.getByLabelText('Pages from first.pdf'), { target: { value: '8' } });
  expect(screen.getByRole('button', { name: 'Create PDF' })).toBeDisabled();
  expect(screen.getByLabelText('Pages from first.pdf')).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(screen.getByLabelText('Pages from first.pdf'), { target: { value: 'all' } });
  await addFile('second.pdf');
  fireEvent.click(screen.getByRole('radio', { name: /Split into separate pages/ }));
  expect(screen.getByRole('button', { name: 'Split pages to ZIP' })).toBeDisabled();
  expect(screen.getByText(/Split works with one PDF/)).toBeInTheDocument();
});

it('does not display a stale download when cancelled work finishes later', async () => {
  let finish!: (result: PdfResult) => void;
  merge.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<PdfWorkbench/>);
  await addFile();
  fireEvent.click(screen.getByRole('button', { name: 'Create PDF' }));
  await screen.findByRole('button', { name: 'Cancel' });
  const signal = merge.mock.calls[0][1];
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(output); });
  expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Cancelled');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('aborts in-flight work when leaving the tool', async () => {
  merge.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<PdfWorkbench/>);
  await addFile();
  fireEvent.click(screen.getByRole('button', { name: 'Create PDF' }));
  await waitFor(() => expect(merge).toHaveBeenCalled());
  const signal = merge.mock.calls[0][1];
  unmount();
  expect(signal?.aborted).toBe(true);
});
