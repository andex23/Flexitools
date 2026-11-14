import { PDFDocument } from 'pdf-lib';
import { zip, Zippable } from 'fflate';

export const PDF_LIMITS = {
  files: 10,
  inputBytes: 100 * 1024 * 1024,
  pages: 500,
  outputBytes: 150 * 1024 * 1024,
};

export interface PdfSource {
  file: File;
  pages: string;
}

export interface PdfInfo {
  pageCount: number;
}

export interface PdfResult {
  blob: Blob;
  filename: string;
  pageCount: number;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('PDF processing cancelled.', 'AbortError');
}

function yieldToBrowser(signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise(resolve => setTimeout(resolve, 0)).then(() => checkAbort(signal));
}

export function validatePdfFiles(files: File[]): void {
  if (!files.length) throw new Error('Choose at least one PDF.');
  if (files.length > PDF_LIMITS.files) throw new Error('Choose up to 10 PDFs at a time.');
  if (files.some(file => !file.size)) throw new Error('An empty file cannot be opened as a PDF.');
  if (files.reduce((total, file) => total + file.size, 0) > PDF_LIMITS.inputBytes) {
    throw new Error('Keep the combined PDF file size under 100 MB.');
  }
}

async function readFile(file: Blob, signal?: AbortSignal): Promise<Uint8Array> {
  checkAbort(signal);
  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      const abort = () => reader.abort();
      const cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
      reader.onerror = () => { cleanup(); reject(new Error('This PDF could not be read. Try selecting it again.')); };
      reader.onabort = () => { cleanup(); reject(new DOMException('PDF processing cancelled.', 'AbortError')); };
      reader.readAsArrayBuffer(file);
    });
  checkAbort(signal);
  return new Uint8Array(buffer);
}

async function loadPdf(file: File, signal?: AbortSignal): Promise<PDFDocument> {
  validatePdfFiles([file]);
  const bytes = await readFile(file, signal);
  // PDF headers can follow a short binary prefix, but must be in the first 1024 bytes.
  const header = Array.from(bytes.slice(0, 1024)).map(value => String.fromCharCode(value)).join('');
  if (!header.includes('%PDF-')) throw new Error(`“${file.name}” is not a readable PDF.`);
  let document: PDFDocument;
  let count: number;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
    count = document.getPageCount();
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && /encrypt/i.test(error.message)) {
      throw new Error(`“${file.name}” is password-protected. Unlock it in your PDF app before adding it here.`);
    }
    throw new Error(`“${file.name}” could not be opened. It may be damaged or unsupported.`);
  }
  checkAbort(signal);
  if (document.isEncrypted) throw new Error(`“${file.name}” is password-protected. Unlock it first.`);
  if (count < 1) throw new Error(`“${file.name}” has no pages.`);
  if (count > PDF_LIMITS.pages) throw new Error('Choose PDFs with no more than 500 pages in total.');
  return document;
}

export async function inspectPdf(file: File, signal?: AbortSignal): Promise<PdfInfo> {
  const document = await loadPdf(file, signal);
  return { pageCount: document.getPageCount() };
}

/** One-based user input becomes ordered zero-based indices; duplicates intentionally repeat pages. */
export function parsePdfPages(selection: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_LIMITS.pages) {
    throw new Error('This PDF has an unsupported page count.');
  }
  const value = selection.trim();
  if (!value) throw new Error('Choose pages, for example all, 1-3, or 3,1,2.');
  if (value.toLowerCase() === 'all') return Array.from({ length: pageCount }, (_, index) => index);
  if (value.length > 4000) throw new Error('The page selection is too long. Use ranges for consecutive pages.');
  const indices: number[] = [];
  for (const token of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token);
    if (!match) throw new Error('Use page numbers and ranges separated by commas, for example 3,1,5-7.');
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pageCount) {
      throw new Error(`Choose page numbers from 1 to ${pageCount}.`);
    }
    if (end < start) throw new Error('Ranges must run forwards. To reverse pages, list them individually, for example 3,2,1.');
    if (indices.length + end - start + 1 > PDF_LIMITS.pages) throw new Error('The output can contain up to 500 pages.');
    for (let page = start; page <= end; page += 1) indices.push(page - 1);
  }
  return indices;
}

function safeStem(filename: string): string {
  // Strip control characters as well as path separators from downloaded filenames.
  // eslint-disable-next-line no-control-regex
  const stem = filename.replace(/\.pdf$/i, '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim();
  return Array.from(stem || 'document').slice(0, 80).join('');
}

export async function mergePdfPages(
  sources: PdfSource[],
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
): Promise<PdfResult> {
  validatePdfFiles(sources.map(source => source.file));
  checkAbort(signal);
  const output = await PDFDocument.create();
  let sourcePages = 0;
  for (let index = 0; index < sources.length; index += 1) {
    await yieldToBrowser(signal);
    const source = sources[index];
    const document = await loadPdf(source.file, signal);
    sourcePages += document.getPageCount();
    if (sourcePages > PDF_LIMITS.pages) throw new Error('Choose PDFs with no more than 500 pages in total.');
    const pages = parsePdfPages(source.pages, document.getPageCount());
    if (output.getPageCount() + pages.length > PDF_LIMITS.pages) throw new Error('The output can contain up to 500 pages.');
    const copied = await output.copyPages(document, pages);
    checkAbort(signal);
    copied.forEach(page => output.addPage(page));
    onProgress?.(index + 1, sources.length);
  }
  await yieldToBrowser(signal);
  const bytes = await output.save();
  checkAbort(signal);
  if (bytes.length > PDF_LIMITS.outputBytes) throw new Error('The result is larger than 150 MB. Process fewer pages at a time.');
  return {
    blob: new Blob([bytes], { type: 'application/pdf' }),
    filename: sources.length === 1 ? `${safeStem(sources[0].file.name)}-pages.pdf` : 'combined.pdf',
    pageCount: output.getPageCount(),
  };
}

function zipPages(files: Zippable, signal?: AbortSignal): Promise<Uint8Array> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      terminate();
      reject(new DOMException('PDF processing cancelled.', 'AbortError'));
    };
    const terminate = zip(files, { level: 0 }, (error, data) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new DOMException('PDF processing cancelled.', 'AbortError'));
      else if (error) reject(new Error('Could not create the ZIP. Try fewer pages.'));
      else resolve(data);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function splitPdfPages(
  source: PdfSource,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
): Promise<PdfResult> {
  const document = await loadPdf(source.file, signal);
  const pages = parsePdfPages(source.pages, document.getPageCount());
  const files: Zippable = {};
  const stem = safeStem(source.file.name);
  let totalBytes = 0;
  for (let index = 0; index < pages.length; index += 1) {
    await yieldToBrowser(signal);
    const output = await PDFDocument.create();
    const [page] = await output.copyPages(document, [pages[index]]);
    output.addPage(page);
    const bytes = await output.save();
    checkAbort(signal);
    totalBytes += bytes.length;
    if (totalBytes > PDF_LIMITS.outputBytes) throw new Error('The split files exceed 150 MB. Split fewer pages at a time.');
    // Sequence prefix preserves the chosen order and keeps repeated page selections unique.
    files[`${String(index + 1).padStart(3, '0')}-${stem}-page-${pages[index] + 1}.pdf`] = bytes;
    onProgress?.(index + 1, pages.length);
  }
  const archive = await zipPages(files, signal);
  checkAbort(signal);
  return { blob: new Blob([archive], { type: 'application/zip' }), filename: `${stem}-pages.zip`, pageCount: pages.length };
}
