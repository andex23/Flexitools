import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import QualityPresets from './QualityPresets';
import ToolIcon from './ToolIcon';
import { CompressionPreset, ImageOutputFormat, MAX_IMAGE_BYTES, formatBytes } from '../utils/imageCompression';
import { BatchImageEntry, MAX_BATCH_BYTES, MAX_BATCH_FILES, compressImageBatch, createBatchZip, validateBatchFiles } from '../utils/batchImages';

function BatchRow({ entry }: { entry: BatchImageEntry }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!entry.result) { setUrl(''); return; }
    const next = URL.createObjectURL(entry.result.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [entry.result]);
  const saving = entry.result ? Math.round((1 - entry.result.blob.size / entry.file.size) * 100) : 0;
  return <li className="batch-file-item">
    <div className="file-row">
      <span className="file-type"><ToolIcon name={entry.status === 'completed' ? 'check' : 'image'} /></span>
      <div className="file-info"><strong title={entry.file.name}>{entry.file.name}</strong><small>
        {formatBytes(entry.file.size)}{entry.result && ` → ${formatBytes(entry.result.blob.size)}`}
        {entry.status === 'queued' && ' · Waiting'}{entry.status === 'processing' && ' · Compressing…'}{entry.status === 'cancelled' && ' · Cancelled'}
        {entry.result && (entry.result.keptOriginal ? ' · Original kept' : saving > 0 ? ` · ${saving}% smaller` : ' · No size reduction')}
      </small></div>
      {url && <a className="secondary-button" href={url} download={entry.downloadName} aria-label={`Download ${entry.downloadName}`}><ToolIcon name="download" size={16} /><span>Download</span></a>}
    </div>
    {entry.error && <p className="error-notice" role="alert">{entry.error}</p>}
    {entry.result?.warning && <p className="status-note">{entry.result.warning}</p>}
  </li>;
}

export default function BatchImageCompressor() {
  const [entries, setEntries] = useState<BatchImageEntry[]>([]);
  const [preset, setPreset] = useState<CompressionPreset>('quality');
  const [format, setFormat] = useState<ImageOutputFormat>('image/webp');
  const [dimension, setDimension] = useState('original');
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');
  const [zipBlob, setZipBlob] = useState<Blob>();
  const [zipUrl, setZipUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController>();
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!zipBlob) { setZipUrl(''); return; }
    const next = URL.createObjectURL(zipBlob); setZipUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [zipBlob]);
  const active = busy || zipping;
  const clearOutputs = () => {
    setEntries(previous => previous.map(entry => ({ file: entry.file, status: 'queued' })));
    setZipBlob(undefined); setError(''); setNotice('');
  };
  const chooseFiles = useCallback((files: File[]) => {
    try { validateBatchFiles(files); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Choose a smaller batch.'); return; }
    generation.current++; controller.current?.abort();
    setEntries(files.map(file => ({ file, status: 'queued' })));
    setZipBlob(undefined); setBusy(false); setZipping(false); setError(''); setNotice('');
  }, []);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files, rejections) => {
      if (rejections.length) {
        setError(rejections.some(item => item.errors.some(rejection => rejection.code === 'file-too-large')) ? 'Each image must be 100 MB or smaller.' : `Choose up to ${MAX_BATCH_FILES} supported JPG, PNG, or WebP images.`);
        return;
      }
      chooseFiles(files);
    },
    multiple: true, maxFiles: MAX_BATCH_FILES, maxSize: MAX_IMAGE_BYTES, disabled: active,
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] },
  });
  const cancel = () => {
    generation.current++; controller.current?.abort(); setBusy(false); setZipping(false);
    setEntries(previous => previous.map(entry => entry.status === 'queued' || entry.status === 'processing' ? { file: entry.file, status: 'cancelled' } : entry));
    setNotice('Cancelled. Completed images are still available to download.');
  };
  const run = async () => {
    const files = entries.map(entry => entry.file);
    const runId = ++generation.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    clearOutputs(); setBusy(true);
    try {
      const limit = dimension === 'original' ? undefined : Number(dimension);
      await compressImageBatch(files, { preset, format, maxWidth: limit, maxHeight: limit }, (index, entry) => {
        if (mounted.current && generation.current === runId) setEntries(previous => previous.map((item, i) => i === index ? entry : item));
      }, request.signal);
      if (mounted.current && generation.current === runId) setNotice('Batch finished. Review the results, then download individually or create a ZIP.');
    } catch (failure) {
      if (mounted.current && generation.current === runId && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'The batch could not finish.');
    } finally { if (mounted.current && generation.current === runId) setBusy(false); }
  };
  const makeZip = async () => {
    const runId = ++generation.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setError(''); setZipping(true); setZipProgress('Preparing ZIP…');
    try {
      const blob = await createBatchZip(entries, request.signal, (done, total) => {
        if (mounted.current && generation.current === runId) setZipProgress(`Packing ${done} of ${total} images…`);
      });
      if (mounted.current && generation.current === runId) setZipBlob(blob);
    } catch (failure) {
      if (mounted.current && generation.current === runId && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not create the ZIP.');
    } finally { if (mounted.current && generation.current === runId) setZipping(false); }
  };
  const completed = entries.filter(entry => entry.status === 'completed');
  const finished = entries.filter(entry => ['completed', 'failed'].includes(entry.status)).length;
  const originalBytes = completed.reduce((bytes, entry) => bytes + entry.file.size, 0);
  const outputBytes = completed.reduce((bytes, entry) => bytes + (entry.result?.blob.size || 0), 0);
  const savings = originalBytes ? Math.round((1 - outputBytes / originalBytes) * 100) : 0;
  return <div className="compressor-grid">
    <section className="workspace-panel" aria-label="Batch image workspace">
      <div className="panel-heading"><span><ToolIcon name="image" size={18} />Your images</span><span className="subtle-tag">On your device</span></div>
      {!entries.length ? <div {...getRootProps({ role: 'button', 'aria-label': 'Choose images', className: `media-dropzone ${isDragActive ? 'dragging' : ''}` })}>
        <input {...getInputProps({ 'aria-label': 'Choose image batch' })} />
        <ToolIcon name="image" size={44} /><h2>A lighter batch, all at once.</h2><p>Drop your images here, or browse your files.</p><span className="primary-button choose-file"><ToolIcon name="upload" size={17} />Choose images</span><small>JPG, PNG, WebP · Up to {MAX_BATCH_FILES} files · {formatBytes(MAX_BATCH_BYTES)} total</small>
      </div> : <>
        <div className="file-row"><div className="file-info"><strong>{entries.length} {entries.length === 1 ? 'image' : 'images'} selected</strong><small>{formatBytes(entries.reduce((bytes, entry) => bytes + entry.file.size, 0))} total · Processed one at a time</small></div><button className="text-button" disabled={active} onClick={open}>Replace batch</button><input {...getInputProps({ 'aria-label': 'Replace image batch' })} /></div>
        <ul className="batch-file-list" aria-label="Batch results">{entries.map((entry, index) => <BatchRow key={`${index}-${entry.file.name}`} entry={entry} />)}</ul>
      </>}
      {active && <div className="processing-state" aria-live="polite"><div className="progress-heading"><strong>{zipping ? zipProgress : `Processing ${Math.min(finished + 1, entries.length)} of ${entries.length} images…`}</strong></div><div className="progress-track" role="progressbar" aria-label="Batch compression progress" aria-valuenow={finished} aria-valuemin={0} aria-valuemax={Math.max(1, entries.length)}><span style={{ width: `${entries.length ? finished / entries.length * 100 : 0}%` }} /></div><button className="secondary-button" onClick={cancel}>Cancel batch</button></div>}
      {!!completed.length && <div className="result-area"><div className="result-head"><span className="success-icon"><ToolIcon name="check" /></span><div><h3>{completed.length} {completed.length === 1 ? 'image' : 'images'} ready</h3><p>{formatBytes(originalBytes)} → {formatBytes(outputBytes)}{savings > 0 ? ` · ${savings}% smaller` : ' · No total size reduction'}</p></div></div><div className="button-row">{zipUrl ? <a className="primary-button" href={zipUrl} download="flexitool-images.zip"><ToolIcon name="download" size={18} />Download ZIP · {formatBytes(zipBlob?.size || 0)}</a> : <button className="primary-button" onClick={makeZip} disabled={active}>Create ZIP of {completed.length} {completed.length === 1 ? 'image' : 'images'}</button>}</div><p className="help-text">Only completed images are included. Duplicate filenames are numbered automatically.</p></div>}
      {notice && <p className="status-note" role="status">{notice}</p>}{error && <p className="error-notice" role="alert">{error}</p>}
      <div className="privacy-line"><ToolIcon name="shield" size={16} /><span>Images and ZIPs are created in your browser. Nothing is uploaded.</span></div>
    </section>
    <aside className="settings-panel" aria-label="Batch image settings"><div className="panel-heading"><span>One set of settings</span><ToolIcon name="spark" size={17} /></div><div className="settings-body">
      <QualityPresets value={preset} onChange={value => { setPreset(value); clearOutputs(); }} disabled={active} lossless={format === 'image/png'} />
      <div className="settings-divider" />
      <label className="field"><span>Batch output format</span><select value={format} disabled={active} onChange={event => { setFormat(event.target.value as ImageOutputFormat); clearOutputs(); }}><option value="image/webp">WebP · recommended</option><option value="image/jpeg">JPG · widely compatible</option><option value="image/png">PNG · lossless encoding</option></select></label>
      <label className="field"><span>Batch image dimensions</span><select value={dimension} disabled={active} onChange={event => { setDimension(event.target.value); clearOutputs(); }}><option value="original">Keep original size</option><option value="2560">Fit within 2560 × 2560 px</option><option value="1920">Fit within 1920 × 1920 px</option><option value="1280">Fit within 1280 × 1280 px</option><option value="800">Fit within 800 × 800 px</option></select><small>Proportions stay the same. Never upscaled.</small></label>
      <button className="primary-button compress-button" disabled={!entries.length || active} onClick={run}><ToolIcon name="spark" size={17} />{busy ? 'Compressing batch…' : 'Compress batch'}<ToolIcon name="arrow" size={17} /></button>
      <p className="settings-footnote">25 images · 100 MB each · 200 MB total<br />Results are limited to 200 MB to protect browser memory.</p>
    </div></aside>
  </div>;
}
