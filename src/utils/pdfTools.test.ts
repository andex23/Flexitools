import { PDFDocument, PDFName } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { inspectPdf, mergePdfPages, parsePdfPages, PDF_LIMITS, splitPdfPages, validatePdfFiles } from './pdfTools';

async function pdfFile(widths: number[], name = 'document.pdf'): Promise<File> {
  const document = await PDFDocument.create();
  widths.forEach(width => document.addPage([width, 400]));
  return new File([await document.save()], name, { type: 'application/pdf' });
}
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

describe('PDF page selection', () => {
  it('preserves custom order and repeated pages', () => {
    expect(parsePdfPages('3, 1, 5-7,3', 8)).toEqual([2, 0, 4, 5, 6, 2]);
    expect(parsePdfPages(' ALL ', 3)).toEqual([0, 1, 2]);
  });

  it.each(['', ' ', '0', '4', '2-4', '3-1', '-1', '1.5', '1,,2', '1,', 'all,1', 'one', '1/2'])('rejects invalid selection %p', selection => {
    expect(() => parsePdfPages(selection, 3)).toThrow();
  });

  it('bounds repeated output pages and rejects invalid source counts', () => {
    expect(() => parsePdfPages(Array(501).fill('1').join(','), 1)).toThrow('500 pages');
    for (const count of [0, 501, NaN, Infinity, 1.5]) expect(() => parsePdfPages('all', count)).toThrow();
  });
});

describe('PDF input checks', () => {
  it('reads real PDFs and rejects non-PDF, empty and corrupted files', async () => {
    await expect(inspectPdf(await pdfFile([100, 200]))).resolves.toEqual({ pageCount: 2 });
    await expect(inspectPdf(new File(['hello'], 'fake.pdf'))).rejects.toThrow('not a readable PDF');
    await expect(inspectPdf(new File([], 'empty.pdf'))).rejects.toThrow('empty file');
    await expect(inspectPdf(new File(['%PDF-1.7\nnot a PDF document'], 'broken.pdf'))).rejects.toThrow('damaged or unsupported');
  });

  it('rejects encrypted PDFs rather than bypassing encryption', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2 }));
    const encrypted = new File([await document.save()], 'locked.pdf', { type: 'application/pdf' });
    await expect(inspectPdf(encrypted)).rejects.toThrow('password-protected');
  });

  it('bounds total bytes, file count and source pages', async () => {
    const file = await pdfFile([100]);
    expect(() => validatePdfFiles([])).toThrow('at least one');
    expect(() => validatePdfFiles(Array(11).fill(file))).toThrow('up to 10');
    const large = new File(['PDF'], 'large.pdf');
    Object.defineProperty(large, 'size', { value: PDF_LIMITS.inputBytes / 2 + 1 });
    expect(() => validatePdfFiles([large, large])).toThrow('100 MB');
    await expect(inspectPdf(await pdfFile(Array(501).fill(100)))).rejects.toThrow('500 pages');
  });
});

describe('local PDF export', () => {
  it('merges actual pages in file and selection order without changing their dimensions', async () => {
    const first = await pdfFile([100, 200, 300], 'first.pdf');
    const second = await pdfFile([400, 500], 'second.pdf');
    const result = await mergePdfPages([{ file: first, pages: '3,1' }, { file: second, pages: '2,1' }]);
    expect(result).toMatchObject({ filename: 'combined.pdf', pageCount: 4 });
    expect(result.blob.type).toBe('application/pdf');
    const reopened = await PDFDocument.load(await readBlob(result.blob));
    expect(reopened.getPages().map(page => page.getWidth())).toEqual([300, 100, 500, 400]);
    expect(reopened.getPages().map(page => page.getHeight())).toEqual([400, 400, 400, 400]);
    expect((await inspectPdf(first)).pageCount).toBe(3);
  });

  it('extracts selected pages and makes a separate, safe filename', async () => {
    const result = await mergePdfPages([{ file: await pdfFile([100, 200], '../report.PDF'), pages: '2' }]);
    expect(result.filename).toBe('_report-pages.pdf');
    expect(result.pageCount).toBe(1);
  });

  it('splits to real single-page PDFs in a ZIP with unique ordered names', async () => {
    const file = await pdfFile([100, 200, 300], '../report.pdf');
    const result = await splitPdfPages({ file, pages: '3,1,3' });
    expect(result.blob.type).toBe('application/zip');
    expect(result.pageCount).toBe(3);
    const entries = unzipSync(await readBlob(result.blob));
    expect(Object.keys(entries)).toEqual(['001-_report-page-3.pdf', '002-_report-page-1.pdf', '003-_report-page-3.pdf']);
    const widths: number[] = [];
    for (const name of Object.keys(entries)) {
      const document = await PDFDocument.load(entries[name]);
      expect(document.getPageCount()).toBe(1);
      widths.push(document.getPage(0).getWidth());
    }
    expect(widths).toEqual([300, 100, 300]);
  });

  it('validates ranges again at export time and rejects oversized combined page counts', async () => {
    const file = await pdfFile([100]);
    await expect(mergePdfPages([{ file, pages: '2' }])).rejects.toThrow('1 to 1');
    await expect(splitPdfPages({ file, pages: '' })).rejects.toThrow('Choose pages');
    const manyPages = await pdfFile(Array(251).fill(100));
    await expect(mergePdfPages([{ file: manyPages, pages: '1' }, { file: manyPages, pages: '1' }])).rejects.toThrow('500 pages in total');
  });

  it('cancels before and during work without returning a partial download', async () => {
    const file = await pdfFile([100, 200, 300]);
    const before = new AbortController();
    before.abort();
    await expect(mergePdfPages([{ file, pages: 'all' }], before.signal)).rejects.toHaveProperty('name', 'AbortError');
    await expect(splitPdfPages({ file, pages: 'all' }, before.signal)).rejects.toHaveProperty('name', 'AbortError');
    const merge = new AbortController();
    await expect(mergePdfPages([{ file, pages: 'all' }], merge.signal, () => merge.abort())).rejects.toHaveProperty('name', 'AbortError');
    const split = new AbortController();
    const progress = jest.fn(() => split.abort());
    await expect(splitPdfPages({ file, pages: 'all' }, split.signal, progress)).rejects.toHaveProperty('name', 'AbortError');
    expect(progress).toHaveBeenCalledTimes(1);
  });
});
