import React, { useEffect, useRef, useState } from 'react';
import MediaUpload from './MediaUpload';
import QualityPresets from './QualityPresets';
import ToolIcon from './ToolIcon';
import { CompressionPreset, formatBytes } from '../utils/imageCompression';
import {
  BROWSER_VIDEO_DISK_INPUT_LIMIT,
  BROWSER_VIDEO_INPUT_LIMIT,
  BROWSER_VIDEO_OUTPUT_LIMIT,
  BrowserVideoCapabilities,
  BrowserVideoMetadata,
  BrowserVideoResult,
  BrowserVideoSettings,
  BrowserVideoWritable,
  convertBrowserVideo,
  getBrowserVideoCapabilities,
  inspectBrowserVideo,
} from '../utils/browserVideo';

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name?: string; createWritable(options: { keepExistingData: false }): Promise<BrowserVideoWritable> }>;
type PickerWindow = Window & { showSaveFilePicker?: SavePicker };
type Phase = 'idle' | 'choosing' | 'processing';
const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', m4a: 'audio/mp4',
  ogg: 'audio/ogg', wav: 'audio/wav',
};
const message = (error: unknown) => error instanceof Error
  ? error.message : 'This file could not be processed. Try another format or a smaller file.';
const seconds = (value: number) => `${Number(value.toFixed(2))} seconds`;

export default function BrowserMediaTools() {
  const [capabilities, setCapabilities] = useState<BrowserVideoCapabilities>();
  const [checking, setChecking] = useState(true);
  const [capabilityError, setCapabilityError] = useState('');
  const [file, setFile] = useState<File>();
  const [metadata, setMetadata] = useState<BrowserVideoMetadata>();
  const [inspecting, setInspecting] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [resultUrl, setResultUrl] = useState<string>();
  const [operation, setOperation] = useState<'video' | 'audio'>('video');
  const [videoFormat, setVideoFormat] = useState<'mp4' | 'webm'>('mp4');
  const [audioFormat, setAudioFormat] = useState<'m4a' | 'ogg' | 'wav'>('m4a');
  const [preset, setPreset] = useState<CompressionPreset>('quality');
  const [maxHeight, setMaxHeight] = useState(0);
  const [trimStart, setTrimStart] = useState('0');
  const [trimEnd, setTrimEnd] = useState('');
  const [mute, setMute] = useState(false);
  const [saveToDisk, setSaveToDisk] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BrowserVideoResult>();
  const [showResult, setShowResult] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const inspection = useRef<AbortController>();
  const conversion = useRef<AbortController>();
  const capabilityGeneration = useRef(0);
  const busy = phase !== 'idle';
  const canSaveToDisk = Boolean(capabilities?.canSaveToDisk &&
    typeof (window as PickerWindow).showSaveFilePicker === 'function');
  const needsDisk = Boolean(file && file.size > BROWSER_VIDEO_INPUT_LIMIT);
  const formats = operation === 'video' ? capabilities?.videoFormats : capabilities?.audioFormats;
  const format = operation === 'video' ? videoFormat : audioFormat;
  const startTime = trimStart.trim() === '' ? NaN : Number(trimStart);
  const endTime = trimEnd.trim() === '' ? metadata?.duration : Number(trimEnd);
  const trimValid = Boolean(metadata && Number.isFinite(startTime) && startTime >= 0 &&
    endTime !== undefined && Number.isFinite(endTime) && endTime > startTime &&
    endTime <= metadata.duration);
  const formatValid = Boolean(formats?.some((available) => available === format));
  const canProcess = Boolean(file && metadata && !checking && !inspecting && !busy &&
    formatValid && trimValid && (operation === 'video' || metadata.hasAudio) &&
    (!needsDisk || canSaveToDisk));

  useEffect(() => {
    mounted.current = true;
    const generation = ++capabilityGeneration.current;
    getBrowserVideoCapabilities().then((available) => {
      if (!mounted.current || capabilityGeneration.current !== generation) return;
      setCapabilities(available);
      if (available.videoFormats[0]) setVideoFormat(available.videoFormats[0]);
      if (available.audioFormats[0]) setAudioFormat(available.audioFormats[0]);
      if (!available.videoFormats.length && available.audioFormats.length) setOperation('audio');
    }).catch((failure: unknown) => {
      if (mounted.current && capabilityGeneration.current === generation)
        setCapabilityError(message(failure));
    }).finally(() => {
      if (mounted.current && capabilityGeneration.current === generation) setChecking(false);
    });
    return () => {
      mounted.current = false;
      capabilityGeneration.current += 1;
      inspection.current?.abort();
      conversion.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!file) { setSourceUrl(undefined); return; }
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!result?.blob) { setResultUrl(undefined); return; }
    const url = URL.createObjectURL(result.blob);
    setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const clearResult = () => {
    setResult(undefined);
    setShowResult(false);
    setPreviewFailed(false);
    setError('');
    setNotice('');
  };

  const selectFile = async (next: File) => {
    if (conversion.current) return;
    if (!next.size) { setError('Choose a video that is not empty.'); return; }
    const limit = canSaveToDisk ? BROWSER_VIDEO_DISK_INPUT_LIMIT : BROWSER_VIDEO_INPUT_LIMIT;
    if (next.size > limit) {
      setError(`This browser can open videos up to ${formatBytes(limit)} here.`);
      return;
    }
    inspection.current?.abort();
    const request = new AbortController();
    inspection.current = request;
    clearResult();
    setMetadata(undefined);
    setFile(next);
    setTrimStart('0');
    setTrimEnd('');
    setSaveToDisk(canSaveToDisk && next.size > BROWSER_VIDEO_INPUT_LIMIT);
    setInspecting(true);
    try {
      const info = await inspectBrowserVideo(next, request.signal);
      if (!mounted.current || request.signal.aborted || inspection.current !== request) return;
      setMetadata(info);
    } catch (failure) {
      if (mounted.current && !request.signal.aborted && inspection.current === request)
        setError(message(failure));
    } finally {
      if (mounted.current && inspection.current === request) setInspecting(false);
    }
  };

  const changeFile = () => {
    inspection.current?.abort();
    inspection.current = undefined;
    setFile(undefined);
    setMetadata(undefined);
    setInspecting(false);
    clearResult();
  };

  const cancel = () => {
    conversion.current?.abort();
    conversion.current = undefined;
    setPhase('idle');
    setProgress(0);
    setNotice('Processing cancelled. Your original file is unchanged.');
  };

  const start = async () => {
    if (!canProcess || !file || conversion.current) return;
    const request = new AbortController();
    conversion.current = request;
    clearResult();
    setProgress(0);
    const direct = canSaveToDisk && (saveToDisk || needsDisk);
    setPhase(direct ? 'choosing' : 'processing');
    const settings: BrowserVideoSettings = {
      operation, format, preset, maxHeight: operation === 'video' ? maxHeight : 0,
      trimStart: startTime, trimEnd: endTime, mute: operation === 'video' && mute,
    };
    let writable: BrowserVideoWritable | undefined;
    let savedFilename: string | undefined;
    let handedToEngine = false;
    const isCurrent = () => mounted.current && !request.signal.aborted && conversion.current === request;
    try {
      if (direct) {
        // This is the first await: the picker must retain the click's user activation.
        const handle = await (window as PickerWindow).showSaveFilePicker!({
          suggestedName: `${file.name.replace(/\.[^.]+$/, '')}-${operation === 'audio' ? 'audio' : 'compressed'}.${format}`,
          types: [{ description: `${format.toUpperCase()} ${operation}`, accept: { [MIME_TYPES[format]]: [`.${format}`] } }],
        });
        if (!isCurrent()) return;
        savedFilename = handle.name;
        writable = await handle.createWritable({ keepExistingData: false });
        if (!isCurrent()) { await writable.abort(); return; }
      }
      if (!isCurrent()) return;
      setPhase('processing');
      handedToEngine = true;
      const output = await convertBrowserVideo(file, settings, {
        signal: request.signal,
        saveToDisk: writable,
        onProgress: (value) => {
          if (isCurrent() && Number.isFinite(value)) setProgress(Math.max(0, Math.min(100, value * 100)));
        },
      });
      if (!isCurrent()) return;
      setResult(savedFilename && output.savedToDisk ? { ...output, filename: savedFilename } : output);
      setShowResult(operation === 'video' && Boolean(output.blob));
      setPreviewFailed(false);
    } catch (failure) {
      if (writable && !handedToEngine) await writable.abort(failure).catch(() => undefined);
      if (!isCurrent()) return;
      if (failure instanceof Error && failure.name === 'AbortError')
        setNotice('Save cancelled. Choose a destination when you are ready.');
      else setError(message(failure));
    } finally {
      if (mounted.current && conversion.current === request) {
        conversion.current = undefined;
        setPhase('idle');
      }
    }
  };

  const measuredSavings = result && file ? Math.round((1 - result.outputBytes / file.size) * 100) : 0;
  const progressPercent = Math.round(progress);

  return (
    <div className="compressor-grid">
      <section className="workspace-panel" aria-label="Browser media workspace">
        <div className="panel-heading">
          <h2>Your video</h2><span className="section-label">PROCESSED ON YOUR DEVICE</span>
        </div>
        {!file ? (
          <MediaUpload kind="video" onSelect={selectFile} disabled={busy || checking}
            maxBytes={canSaveToDisk ? BROWSER_VIDEO_DISK_INPUT_LIMIT : BROWSER_VIDEO_INPUT_LIMIT} />
        ) : (
          <>
            <div className="file-row">
              <span className="file-type-icon"><ToolIcon name="video" size={22} /></span>
              <div className="file-info">
                <strong title={file.name}>{file.name}</strong>
                <span>{formatBytes(file.size)} · Original file</span>
                {metadata && <small>{metadata.width} × {metadata.height} px · {seconds(metadata.duration)}{!metadata.hasAudio && ' · No audio track'}</small>}
              </div>
              <button type="button" className="text-button" disabled={busy} onClick={changeFile}>Change file</button>
            </div>
            {resultUrl && operation === 'video' && (
              <div className="preview-toggle" aria-label="Video preview">
                <button type="button" aria-pressed={!showResult} onClick={() => { setShowResult(false); setPreviewFailed(false); }}>Original</button>
                <button type="button" aria-pressed={showResult} onClick={() => { setShowResult(true); setPreviewFailed(false); }}>Processed</button>
              </div>
            )}
            <div className="preview-stage video-preview">
              {sourceUrl && <video key={showResult && resultUrl ? resultUrl : sourceUrl}
                src={showResult && resultUrl ? resultUrl : sourceUrl} controls preload="metadata" playsInline
                onError={() => setPreviewFailed(true)} aria-label={showResult ? 'Processed video preview' : 'Original video preview'} />}
            </div>
            {previewFailed && <p className="status-note">This browser cannot preview this file. Processing support is checked separately; you can review exported files in a compatible player.</p>}
          </>
        )}

        {inspecting && <p className="status-note" role="status">Reading video information…</p>}
        {busy && (
          <div className="processing-state" aria-live="polite">
            <div className="progress-heading">
              <strong>{phase === 'choosing' ? 'Choose where to save your file…' : operation === 'audio' ? 'Extracting audio on your device…' : 'Processing video on your device…'}</strong>
              {phase === 'processing' && <span>{progressPercent}%</span>}
            </div>
            {phase === 'processing' && <div className="progress-track" role="progressbar" aria-label="Media processing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><span style={{ width: `${progressPercent}%` }} /></div>}
            <p className="help-text">Keep this page open. Speed and supported file sizes depend on your device. You can use the other tools while this finishes.</p>
            <button type="button" className="secondary-button" onClick={cancel}>Cancel processing</button>
          </div>
        )}

        {result && file && (
          <div className="compression-result" aria-live="polite">
            <div className="result-heading">
              <h3>{result.savedToDisk ? 'Saved to your device' : operation === 'audio' ? 'Your audio is ready' : 'Your video is ready'}</h3>
              {operation === 'video' && result.outputBytes < file.size && <span className="savings-badge">{measuredSavings > 0 ? `${measuredSavings}% smaller` : 'Less than 1% smaller'}</span>}
            </div>
            <div className="result-stats">
              <div><span>Original video</span><strong>{formatBytes(file.size)}</strong></div>
              <ToolIcon name="arrow" size={20} />
              <div><span>{operation === 'audio' ? 'Extracted audio' : 'Processed video'}</span><strong>{formatBytes(result.outputBytes)}</strong></div>
            </div>
            <p className="help-text">{format.toUpperCase()}{result.width && result.height ? ` · ${result.width} × ${result.height} px` : ''} · {seconds(result.duration)}</p>
            {operation === 'video' && result.outputBytes >= file.size && <p className="status-note">The output is not smaller. This source may already be efficiently compressed; keep your original or try a lower resolution or another preset.</p>}
            {operation === 'audio' && <p className="help-text">Audio extraction removes the video track. These sizes are not a video compression comparison.</p>}
            {result.warning && <p className="status-note">{result.warning}</p>}
            {resultUrl && operation === 'audio' && <audio src={resultUrl} controls preload="metadata" aria-label="Extracted audio preview" />}
            {resultUrl && <a className="primary-button" href={resultUrl} download={result.filename}><ToolIcon name="download" size={18} />Download {format.toUpperCase()}</a>}
            {result.savedToDisk && <p className="help-text">{result.filename} is saved in your chosen location. Open it there to review the result.</p>}
          </div>
        )}
        {error && <p role="alert" className="error-notice">{error}</p>}
        {notice && <p role="status" className="status-note">{notice}</p>}
        <p className="privacy-line"><ToolIcon name="shield" size={16} />Files stay on your device. No uploads, account, or payment.</p>
      </section>

      <aside className="settings-panel" aria-label="Media settings">
        <div className="panel-heading"><h2>Make it yours</h2><ToolIcon name="spark" size={18} /></div>
        <>
          {checking && <p className="status-note" role="status">Checking this browser’s media support…</p>}
          {!checking && (capabilityError || !capabilities?.supported) && <p className="error-notice" role="alert">{capabilityError || capabilities?.reason || 'This browser does not support local media encoding.'} Try a recent desktop Chrome or Edge browser. Image tools are still available.</p>}
          <div className="settings-section">
            <span className="section-label">WHAT WOULD YOU LIKE TO DO?</span>
            <div className="preview-toggle" aria-label="Media operation">
              <button type="button" aria-pressed={operation === 'video'} disabled={busy || checking || !capabilities?.videoFormats.length}
                onClick={() => { setOperation('video'); clearResult(); }}>Compress video</button>
              <button type="button" aria-pressed={operation === 'audio'} disabled={busy || checking || !capabilities?.audioFormats.length}
                onClick={() => { setOperation('audio'); clearResult(); }}>Extract audio</button>
            </div>
            {operation === 'audio' && metadata && !metadata.hasAudio && <p role="alert" className="error-text">This video has no audio track to extract.</p>}
            <label className="field"><span>Output format</span>
              <select value={formatValid ? format : ''} disabled={busy || checking || !formats?.length}
                onChange={(event) => { operation === 'video' ? setVideoFormat(event.target.value as 'mp4' | 'webm') : setAudioFormat(event.target.value as 'm4a' | 'ogg' | 'wav'); clearResult(); }}>
                {!formats?.length && <option value="">No supported format</option>}
                {formats?.map((available) => <option key={available} value={available}>{available.toUpperCase()}{available === 'wav' ? ' · Uncompressed audio' : ''}</option>)}
              </select>
              <small>Only formats this browser can encode are listed. Source codec support is checked when processing.</small>
            </label>
          </div>
          {format !== 'wav' && <div className="settings-section"><QualityPresets value={preset} onChange={(value) => { setPreset(value); clearResult(); }} disabled={busy} /><p className="help-text">Best quality aims to preserve detail. Re-encoding can lose quality, and a smaller file is not guaranteed.</p></div>}
          {format === 'wav' && <p className="status-note">WAV is uncompressed and can be much larger. Choose M4A or Ogg when available for a smaller audio file.</p>}
          {operation === 'video' && <div className="settings-section">
            <label className="field"><span>Maximum resolution</span>
              <select value={maxHeight} disabled={busy} onChange={(event) => { setMaxHeight(Number(event.target.value)); clearResult(); }}>
                <option value={0}>Original resolution</option><option value={2160}>4K · 2160p</option><option value={1440}>1440p</option><option value={1080}>Full HD · 1080p</option><option value={720}>HD · 720p</option><option value={480}>480p</option>
              </select><small>Smaller videos stay at their original size. Aspect ratio is preserved.</small>
            </label>
            <label className="video-consent"><input type="checkbox" checked={mute} disabled={busy} onChange={(event) => { setMute(event.target.checked); clearResult(); }} />Remove audio from video</label>
          </div>}
          <div className="settings-section">
            <span className="section-label">TRIM · OPTIONAL</span>
            <label className="field"><span>Start time (seconds)</span><input type="number" min="0" step="0.01" value={trimStart} disabled={busy || !metadata} aria-invalid={Boolean(metadata && !trimValid)} onChange={(event) => { setTrimStart(event.target.value); clearResult(); }} /></label>
            <label className="field"><span>End time (seconds)</span><input type="number" min="0" step="0.01" max={metadata?.duration} placeholder={metadata ? String(Number(metadata.duration.toFixed(2))) : 'Full video'} value={trimEnd} disabled={busy || !metadata} aria-invalid={Boolean(metadata && !trimValid)} onChange={(event) => { setTrimEnd(event.target.value); clearResult(); }} /><small>Leave the end blank to keep the full remaining duration.</small></label>
            {metadata && !trimValid && <p className="error-text" role="alert">Choose a start before the end, within the video’s duration.</p>}
          </div>
          <div className="settings-section">
            {canSaveToDisk && <label className="video-consent"><input type="checkbox" checked={saveToDisk || needsDisk} disabled={busy || needsDisk} onChange={(event) => { setSaveToDisk(event.target.checked); clearResult(); }} />Save directly to a file</label>}
            <p className="help-text">{canSaveToDisk ? `Direct saving avoids holding the finished file in memory and is required for inputs above ${formatBytes(BROWSER_VIDEO_INPUT_LIMIT)}. Inputs up to ${formatBytes(BROWSER_VIDEO_DISK_INPUT_LIMIT)} can be attempted; device limits still apply.` : `This browser supports inputs up to ${formatBytes(BROWSER_VIDEO_INPUT_LIMIT)} here. Large videos need a desktop browser that supports direct file saving.`} Downloads held in memory are limited to {formatBytes(BROWSER_VIDEO_OUTPUT_LIMIT)}.</p>
          </div>
          <button type="button" className="primary-button" disabled={!canProcess} onClick={start}><ToolIcon name={operation === 'audio' ? 'convert' : 'video'} size={18} />{busy ? 'Working…' : operation === 'audio' ? 'Extract audio file' : 'Process video'}</button>
          <p className="settings-footnote">Free browser processing uses your device’s media codecs. Multi-GB videos need sufficient storage and memory; support varies by browser and file.</p>
        </>
      </aside>
    </div>
  );
}
