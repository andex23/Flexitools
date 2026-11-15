import React, { useEffect, useId, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '../utils/imageCompression';
import { inspectPdf, mergePdfPages, parsePdfPages, PDF_LIMITS, PdfResult, splitPdfPages, validatePdfFiles } from '../utils/pdfTools';
import ToolIcon from './ToolIcon';

interface Entry { id: number; file: File; pageCount: number; pages: string }
type Mode = 'merge' | 'split';

export default function PdfWorkbench() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<Mode>('merge');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PdfResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const request = useRef<AbortController>();
  const generation = useRef(0);
  const nextId = useRef(0);
  const mounted = useRef(true);
  const groupId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!result) { setDownloadUrl(''); return; }
    const url = URL.createObjectURL(result.blob);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  const invalidate = () => { setResult(null); setError(''); setStatus(''); };
  const addFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    invalidate();
    try { validatePdfFiles([...entries.map(entry => entry.file), ...files]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Choose valid PDF files.'); return; }
    const run = ++generation.current;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller; setBusy(true);
    try {
      const additions: Entry[] = [];
      for (let index = 0; index < files.length; index += 1) {
        if (controller.signal.aborted || generation.current !== run || !mounted.current) return;
        setStatus(`Reading PDF ${index + 1} of ${files.length} on your device…`);
        const info = await inspectPdf(files[index], controller.signal);
        additions.push({ id: nextId.current++, file: files[index], pageCount: info.pageCount, pages: 'all' });
      }
      if ([...entries, ...additions].reduce((sum, entry) => sum + entry.pageCount, 0) > PDF_LIMITS.pages) {
        throw new Error('Choose PDFs with no more than 500 pages in total.');
      }
      if (mounted.current && generation.current === run && !controller.signal.aborted) {
        setEntries(current => [...current, ...additions]); setStatus('PDFs are ready. Choose your pages and their order.');
      }
    } catch (failure) {
      if (mounted.current && generation.current === run && !controller.signal.aborted) { setStatus(''); setError(failure instanceof Error ? failure.message : 'Could not open this PDF.'); }
    } finally {
      if (mounted.current && generation.current === run) { setBusy(false); request.current = undefined; }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files, rejected) => { if (!rejected.length) void addFiles(files); },
    accept: { 'application/pdf': ['.pdf'] }, multiple: true, disabled: busy,
    maxSize: PDF_LIMITS.inputBytes,
    onDropRejected: () => setError('Choose PDF files with a combined size under 100 MB.'),
  });

  const selectionErrors = entries.map(entry => {
    try { parsePdfPages(entry.pages, entry.pageCount); return ''; }
    catch (failure) { return failure instanceof Error ? failure.message : 'Choose valid pages.'; }
  });
  const selectedCount = entries.reduce((total, entry, index) => total + (selectionErrors[index] ? 0 : parsePdfPages(entry.pages, entry.pageCount).length), 0);
  const valid = entries.length > 0 && !selectionErrors.some(Boolean) && selectedCount <= PDF_LIMITS.pages && (mode === 'merge' || entries.length === 1);

  const move = (index: number, direction: -1 | 1) => {
    invalidate();
    setEntries(current => { const reordered = [...current]; const target = index + direction; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]; return reordered; });
  };

  const runTool = async () => {
    if (!valid || busy) return;
    invalidate();
    const run = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setStatus('Preparing your PDF on this device…');
    const progress = (done: number, total: number) => {
      if (mounted.current && generation.current === run && !controller.signal.aborted) {
        setStatus(mode === 'split' ? `Preparing page ${done} of ${total}…` : `Combining PDF ${done} of ${total}…`);
      }
    };
    try {
      const sources = entries.map(({ file, pages }) => ({ file, pages }));
      const output = mode === 'merge' ? await mergePdfPages(sources, controller.signal, progress) : await splitPdfPages(sources[0], controller.signal, progress);
      if (mounted.current && generation.current === run && !controller.signal.aborted) {
        setResult(output); setStatus('Your download is ready.');
      }
    } catch (failure) {
      if (mounted.current && generation.current === run && !controller.signal.aborted) { setStatus(''); setError(failure instanceof Error ? failure.message : 'PDF processing failed. Try fewer pages.'); }
    } finally {
      if (mounted.current && generation.current === run) { setBusy(false); request.current = undefined; }
    }
  };

  const cancel = () => {
    generation.current += 1; request.current?.abort(); request.current = undefined;
    setBusy(false); setStatus('Cancelled. Your original PDFs are unchanged.');
  };

  return <div className="compressor-grid">
    <section className="workspace-panel" aria-label="PDF workspace">
      <div className="panel-heading"><span><ToolIcon name="pdf" size={18}/>Your PDFs</span><span className="subtle-tag">On your device</span></div>
      <div {...getRootProps({ role: 'button', 'aria-label': 'Choose PDF files', className: `media-dropzone ${isDragActive ? 'dragging' : ''} ${busy ? 'disabled' : ''}` })}>
        <input {...getInputProps({ 'aria-label': 'Add PDF files' })}/>
        <ToolIcon name="pdf" size={36}/><h2>{entries.length ? 'Add another PDF' : 'Put your pages in order'}</h2>
        <p>Drop PDFs here, or browse your files.</p>
        <span className="primary-button choose-file"><ToolIcon name="upload" size={17}/>Choose PDFs</span>
        <small>Up to 10 files · 100 MB combined · 500 pages</small>
      </div>
      {entries.map((entry, index) => <div className="pdf-entry" key={entry.id} style={{ padding: '16px 20px', borderTop: '1px solid var(--line)' }}>
        <div className="file-row" style={{ padding: '0 0 14px', border: 0 }}>
          <span className="file-type"><ToolIcon name="pdf"/></span>
          <div className="file-info"><strong title={entry.file.name}>{index + 1}. {entry.file.name}</strong><small>{entry.pageCount} pages · {formatBytes(entry.file.size)}</small></div>
        </div>
        <div className="button-row" style={{ margin: '0 0 14px' }}>
          <button className="secondary-button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`Move ${entry.file.name} up`}>Move up</button>
          <button className="secondary-button" disabled={busy || index === entries.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${entry.file.name} down`}>Move down</button>
          <button className="text-button" disabled={busy} onClick={() => { invalidate(); setEntries(current => current.filter(item => item.id !== entry.id)); }} aria-label={`Remove ${entry.file.name}`}>Remove</button>
        </div>
        <div className="field"><label htmlFor={`${groupId}-selection-${entry.id}`}><span>Pages from {entry.file.name}</span></label><input id={`${groupId}-selection-${entry.id}`} value={entry.pages} disabled={busy} onChange={event => { const pages = event.target.value; invalidate(); setEntries(current => current.map(item => item.id === entry.id ? { ...item, pages } : item)); }} aria-invalid={Boolean(selectionErrors[index])} aria-describedby={`${groupId}-pages-${entry.id}`}/><small id={`${groupId}-pages-${entry.id}`}>{selectionErrors[index] || 'Use all, a range like 1-3, or a custom order like 3,1,2. Repeating a number repeats that page.'}</small></div>
      </div>)}
      {status && <p className="status-note" role="status" style={{ margin: '16px 20px' }}>{status}</p>}
      {error && <p className="error-notice" role="alert">{error}</p>}
      {result && downloadUrl && <div className="result-area"><div className="result-head"><span className="success-icon"><ToolIcon name="check"/></span><div><h3>{result.pageCount} pages, ready to go.</h3><p>{formatBytes(result.blob.size)} · {result.filename}</p></div></div><a className="primary-button download-button" href={downloadUrl} download={result.filename}><ToolIcon name="download" size={18}/>Download {mode === 'split' ? 'ZIP' : 'PDF'}</a></div>}
      <div className="privacy-line"><ToolIcon name="shield" size={15}/><span>Your PDFs never leave this browser. Originals stay unchanged.</span></div>
    </section>
    <aside className="settings-panel" aria-label="PDF organization settings">
      <div className="panel-heading"><span>Make it yours</span><ToolIcon name="pdf" size={18}/></div>
      <div className="settings-body">
        <fieldset className="quality-fieldset" disabled={busy}><legend className="section-label">What would you like to do?</legend>
          <label className={`quality-option ${mode === 'merge' ? 'selected' : ''}`}><input type="radio" name={groupId} checked={mode === 'merge'} onChange={() => { setMode('merge'); invalidate(); }}/><span><strong>Merge or extract</strong><small>One PDF, in the order you choose</small></span></label>
          <label className={`quality-option ${mode === 'split' ? 'selected' : ''}`}><input type="radio" name={groupId} checked={mode === 'split'} onChange={() => { setMode('split'); invalidate(); }}/><span><strong>Split into separate pages</strong><small>One PDF per selected page, in a ZIP</small></span></label>
        </fieldset>
        <p className="help-text">Move files up or down to change their order. Change a file’s page selection to reorder or extract just the pages you need.</p>
        {mode === 'split' && entries.length > 1 && <p className="status-note">Split works with one PDF at a time. Remove the extra files, or switch to merge.</p>}
        {selectedCount > PDF_LIMITS.pages && <p className="error-notice" role="alert" style={{ margin: '14px 0' }}>The output can contain up to 500 pages.</p>}
        <p className="status-note">{selectedCount} selected pages from {entries.length} {entries.length === 1 ? 'file' : 'files'}.</p>
        <button className="primary-button compress-button" disabled={busy || !valid} onClick={runTool}>{busy ? <span className="spinner"/> : <ToolIcon name="spark" size={17}/>} {busy ? 'Working on your PDFs…' : mode === 'split' ? 'Split pages to ZIP' : 'Create PDF'}</button>
        {busy && <button className="secondary-button" onClick={cancel}>Cancel</button>}
        <p className="help-text">Creates a new document from the selected pages. Digital signatures are not preserved, and interactive forms, bookmarks or attachments may not carry over. Review the result before sharing.</p>
      </div>
    </aside>
  </div>;
}
