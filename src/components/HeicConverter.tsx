import React, { useEffect, useRef, useState } from 'react';
import ToolIcon from './ToolIcon';
import { formatBytes, ImageOutputFormat } from '../utils/imageCompression';
import {
  convertHeic,
  HeicResult,
  MAX_HEIC_BYTES,
} from '../utils/heicConversion';

export default function HeicConverter() {
  const [file, setFile] = useState<File>();
  const [format, setFormat] = useState<ImageOutputFormat>('image/jpeg');
  const [result, setResult] = useState<HeicResult>();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController>();
  useEffect(() => {
    if (!result) {
      setUrl('');
      return;
    }
    const value = URL.createObjectURL(result.blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [result]);
  useEffect(
    () => () => {
      abort.current?.abort();
      abort.current = undefined;
    },
    [],
  );
  const run = async () => {
    if (!file || busy) return;
    const request = new AbortController();
    abort.current = request;
    setBusy(true);
    setCancelling(false);
    setResult(undefined);
    setError('');
    try {
      const output = await convertHeic(file, format, request.signal);
      if (!request.signal.aborted) setResult(output);
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not convert this HEIC file.',
        );
    } finally {
      if (abort.current === request) {
        setBusy(false);
        setCancelling(false);
        abort.current = undefined;
      }
    }
  };
  return (
    <div className="compressor-grid">
      <section className="workspace-panel">
        <div className="panel-heading">
          <span>
            <ToolIcon name="image" />
            Your HEIC photo
          </span>
          <span className="subtle-tag">On your device</span>
        </div>
        <div className="settings-body">
          <label className="field">
            <span>Choose a HEIC or HEIF still photo</span>
            <input
              type="file"
              accept=".heic,.heif,image/heic,image/heif"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = '';
                setResult(undefined);
                setError('');
                if (selected && selected.size > MAX_HEIC_BYTES) {
                  setFile(undefined);
                  setError('Choose a HEIC file smaller than 30 MB.');
                  return;
                }
                setFile(selected);
              }}
            />
            <small>
              Up to 30 MB and 50 megapixels. Your photo is never uploaded.
            </small>
          </label>
          {file && (
            <div className="file-row">
              <ToolIcon name="image" />
              <div className="file-info">
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
            </div>
          )}
          {busy && (
            <p className="processing-note" role="status">
              <span className="spinner" />
              {cancelling
                ? 'Cancelling after the current decode finishes…'
                : 'Loading the decoder and converting your photo…'}
            </p>
          )}
          {error && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
          {result && url && (
            <div aria-live="polite">
              <div className="image-stage">
                <img src={url} alt="Converted HEIC preview" />
              </div>
              <p className="help-text">
                {result.width} × {result.height} px ·{' '}
                {formatBytes(result.blob.size)}
                {file && result.blob.size > file.size
                  ? ' · This format is larger than your original.'
                  : ''}
              </p>
              <a
                href={url}
                download={result.filename}
                className="primary-button download-button"
              >
                <ToolIcon name="download" />
                Download{' '}
                {format === 'image/jpeg'
                  ? 'JPG'
                  : format === 'image/png'
                    ? 'PNG'
                    : 'WebP'}
              </a>
            </div>
          )}
        </div>
        <div className="privacy-line">
          <ToolIcon name="shield" size={16} />
          Converted locally. No account or paid service.
        </div>
      </section>
      <aside className="settings-panel" aria-label="HEIC conversion settings">
        <div className="panel-heading">
          <span>A format you can share</span>
          <ToolIcon name="convert" />
        </div>
        <div className="settings-body">
          <label className="field">
            <span>Output format</span>
            <select
              value={format}
              disabled={busy}
              onChange={(event) => {
                setFormat(event.target.value as ImageOutputFormat);
                setResult(undefined);
                setError('');
              }}
            >
              <option value="image/jpeg">JPG · widely compatible</option>
              <option value="image/png">PNG · lossless encoding</option>
              <option value="image/webp">WebP · smaller files</option>
            </select>
            <small>
              JPG and WebP use high-quality encoding. A smaller output is not
              guaranteed.
            </small>
          </label>
          <p className="status-note">
            Exports the primary still photo only. Additional images, Live Photo
            motion, depth information, HDR and original metadata are not
            preserved. HEIC image sequences are not supported.
          </p>
          <button
            className="primary-button compress-button"
            disabled={!file || busy}
            onClick={run}
          >
            <ToolIcon name="convert" />
            {busy ? 'Converting…' : 'Convert HEIC'}
          </button>
          {busy && (
            <button
              className="secondary-button"
              disabled={cancelling}
              onClick={() => {
                abort.current?.abort();
                setCancelling(true);
              }}
            >
              Cancel conversion
            </button>
          )}
          <p className="settings-footnote">
            The free decoder loads only when you convert. The first photo may
            take longer.
          </p>
        </div>
      </aside>
    </div>
  );
}
