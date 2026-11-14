import React, { useEffect, useRef, useState } from 'react';
import { formatBytes, ImageOutputFormat } from '../utils/imageCompression';
import { editImage, editedFilename, getEditGeometry, ImageEditResult, ImageRotation, inspectImageForEditing } from '../utils/imageEditing';
import MediaUpload from './MediaUpload';
import ToolIcon from './ToolIcon';

type CropFields = { x: string; y: string; width: string; height: string };

export default function ImageEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<'edit' | 'metadata'>('edit');
  const [format, setFormat] = useState<ImageOutputFormat>('image/png');
  const [crop, setCrop] = useState<CropFields>({ x: '0', y: '0', width: '', height: '' });
  const [rotation, setRotation] = useState<ImageRotation>(0);
  const [watermark, setWatermark] = useState('');
  const [position, setPosition] = useState<'bottom-right' | 'center'>('bottom-right');
  const [opacity, setOpacity] = useState('70');
  const [size, setSize] = useState('5');
  const [originalUrl, setOriginalUrl] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [result, setResult] = useState<ImageEditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!file || !dimensions) { setOriginalUrl(''); return; }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, dimensions]);
  useEffect(() => {
    if (!result) { setOutputUrl(''); return; }
    const url = URL.createObjectURL(result.blob);
    setOutputUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const clearResult = () => { setResult(null); setError(''); };
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setLoading(false);
  };
  const selectFile = async (next: File | null) => {
    cancel();
    clearResult();
    setFile(next);
    setDimensions(null);
    setRotation(0);
    if (!next) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const measured = await inspectImageForEditing(next, controller.signal);
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setDimensions(measured);
      setCrop({ x: '0', y: '0', width: String(measured.width), height: String(measured.height) });
    } catch (e) {
      if (!controller.signal.aborted && abortRef.current === controller) {
        setError(e instanceof Error ? e.message : 'Could not read this image. Try another file.');
      }
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setLoading(false); }
    }
  };
  const run = async () => {
    if (!file || !dimensions || busy || loading) return;
    clearResult();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      let selection;
      if (mode === 'edit') {
        if (Object.values(crop).some(value => !value.trim())) throw new Error('Fill in all four crop values using whole pixels.');
        selection = { x: Number(crop.x), y: Number(crop.y), width: Number(crop.width), height: Number(crop.height) };
        getEditGeometry(dimensions.width, dimensions.height, selection, rotation);
      }
      const output = await editImage(file, {
        mode, format,
        ...(mode === 'edit' ? {
          crop: selection, rotation,
          watermark: { text: watermark, position, opacity: Number(opacity) / 100, sizePercent: Number(size) },
        } : {}),
      }, controller.signal);
      if (!controller.signal.aborted && abortRef.current === controller) setResult(output);
    } catch (e) {
      if (!controller.signal.aborted && abortRef.current === controller) setError(e instanceof Error ? e.message : 'Could not edit this image. Try another file.');
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setBusy(false); }
    }
  };
  const working = loading || busy;
  const setCropField = (key: keyof CropFields, value: string) => { setCrop(previous => ({ ...previous, [key]: value })); clearResult(); };

  return (
    <div className="compressor-grid">
      <div className="workspace-column">
        <section className="workspace-panel">
          <div className="panel-heading">
            <span><ToolIcon name="image" size={18} />Your image</span>
            <span className="subtle-tag"><span className="status-dot" />On your device</span>
          </div>
          {!file ? <MediaUpload kind="image" onSelect={selectFile} /> : <>
            <div className="file-row">
              <span className="file-type"><ToolIcon name="image" /></span>
              <span className="file-info"><strong>{file.name}</strong><small>{formatBytes(file.size)}{dimensions && ` · ${dimensions.width} × ${dimensions.height} px`}</small></span>
              <button className="icon-button" aria-label="Remove image" onClick={() => selectFile(null)}><ToolIcon name="close" size={18} /></button>
            </div>
            {loading && <p className="processing-note" role="status"><span className="spinner" />Checking your image…</p>}
            {dimensions && <div className={`comparison ${result ? 'has-result' : ''}`}>
              <figure>
                <figcaption><span>ORIGINAL</span><span>{dimensions.width} × {dimensions.height} px</span></figcaption>
                <div className="image-stage">{originalUrl && <img src={originalUrl} alt="Original before editing" />}</div>
              </figure>
              {result && <figure>
                <figcaption><span>{mode === 'metadata' ? 'CLEANED COPY' : 'EDITED'}</span><span>{result.width} × {result.height} px</span></figcaption>
                <div className="image-stage">{outputUrl && <img src={outputUrl} alt={mode === 'metadata' ? 'Re-encoded image with source metadata removed' : 'Edited result showing crop, rotation, and watermark'} />}</div>
              </figure>}
            </div>}
            {dimensions && !result && !busy && <p className="preview-caption">Choose your settings, then create a preview. Your original stays untouched.</p>}
            {busy && <p className="processing-note" role="status"><span className="spinner" />Creating your image…</p>}
            {result && <div className="result-area" aria-live="polite">
              <div className="result-head"><span className="success-icon"><ToolIcon name="check" /></span><div><h3>{mode === 'metadata' ? 'Your cleaned copy is ready.' : 'Your edited image is ready.'}</h3><p>{formatBytes(file.size)} → {formatBytes(result.blob.size)} · {result.width} × {result.height} px</p></div></div>
              <p className="status-note">{result.warning}</p>
              {outputUrl && <a className="primary-button download-button" href={outputUrl} download={editedFilename(file.name, format, mode)}><ToolIcon name="download" size={18} />{mode === 'metadata' ? 'Download cleaned copy' : 'Download edited image'}<span>{formatBytes(result.blob.size)}</span></a>}
            </div>}
          </>}
          {error && <p className="error-notice" role="alert">{error}</p>}
          <div className="privacy-line"><ToolIcon name="shield" size={15} /><span>Your images stay in your browser. No account or upload needed.</span></div>
        </section>
        <div className="tip-row"><span className="tip-icon"><ToolIcon name="spark" size={20} /></span><div><h3>A little polish before you share.</h3><p>Crop out distractions, rotate your photo, or add a text watermark. Use Remove metadata to make a fresh copy without copying embedded location or camera details.</p></div></div>
      </div>
      <aside className="settings-panel" aria-label="Image editing settings">
        <div className="panel-heading"><span>Make it yours</span><ToolIcon name="spark" size={17} /></div>
        <div className="settings-body">
          <label className="field"><span>Tool</span><select value={mode} disabled={working} onChange={event => { setMode(event.target.value as typeof mode); clearResult(); }}><option value="edit">Crop, rotate & watermark</option><option value="metadata">Remove metadata</option></select></label>
          {mode === 'metadata' ? <p className="status-note">Make a new image without copying embedded location, camera, or other source metadata. Color profiles may also be removed. Re-encoding can change colors, quality, and file size; visible content stays in the image.</p> : <>
            <p className="help-text">Crop coordinates are in the original image shown on the left. The crop is applied before rotation.</p>
            {([
              ['x', 'Left (px)', 0], ['y', 'Top (px)', 0], ['width', 'Crop width (px)', 1], ['height', 'Crop height (px)', 1],
            ] as const).map(([key, label, min]) => <label className="field" key={key}><span>{label}</span><input type="number" min={min} step="1" value={crop[key]} disabled={working || !dimensions} onChange={event => setCropField(key, event.target.value)} /></label>)}
            <button className="secondary-button" disabled={working || !dimensions} onClick={() => { if (dimensions) setCrop({ x: '0', y: '0', width: String(dimensions.width), height: String(dimensions.height) }); clearResult(); }}>Use full image</button>
            <label className="field"><span>Rotation</span><select value={rotation} disabled={working} onChange={event => { setRotation(Number(event.target.value) as ImageRotation); clearResult(); }}><option value="0">No rotation</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counterclockwise</option></select></label>
            <div className="settings-divider" />
            <label className="field"><span>Text watermark (optional)</span><input type="text" maxLength={100} placeholder="Your name or website" value={watermark} disabled={working} onChange={event => { setWatermark(event.target.value); clearResult(); }} /></label>
            {watermark.trim() && <>
              <label className="field"><span>Watermark position</span><select value={position} disabled={working} onChange={event => { setPosition(event.target.value as typeof position); clearResult(); }}><option value="bottom-right">Bottom right</option><option value="center">Center</option></select></label>
              <label className="field"><span>Watermark opacity (%)</span><input type="number" min="10" max="100" step="1" value={opacity} disabled={working} onChange={event => { setOpacity(event.target.value); clearResult(); }} /></label>
              <label className="field"><span>Watermark size (% of shorter side)</span><input type="number" min="1" max="15" step="1" value={size} disabled={working} onChange={event => { setSize(event.target.value); clearResult(); }} /></label>
            </>}
          </>}
          <div className="settings-divider" />
          <label className="field"><span>Output format</span><select value={format} disabled={working} onChange={event => { setFormat(event.target.value as ImageOutputFormat); clearResult(); }}><option value="image/png">PNG · lossless encoding</option><option value="image/jpeg">JPG · smaller photos</option><option value="image/webp">WebP · smaller web images</option></select></label>
          <p className="help-text">PNG avoids further lossy compression but may create a larger file. JPG and WebP use high quality settings. JPG replaces transparency with white.</p>
          <button className="primary-button" onClick={run} disabled={!dimensions || working}>{busy ? 'Creating image…' : mode === 'metadata' ? 'Remove metadata & preview' : 'Apply edits & preview'}<ToolIcon name="arrow" size={18} /></button>
          {working && <button className="secondary-button" onClick={cancel}>Cancel</button>}
          <p className="help-text">Still JPG, PNG, or WebP. Up to 100 MB and 50 megapixels, with a maximum edge of 16,384 pixels.</p>
        </div>
      </aside>
    </div>
  );
}
