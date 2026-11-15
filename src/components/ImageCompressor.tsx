import React, { useEffect, useRef, useState } from 'react';
import {
  compressImage,
  CompressionPreset,
  ImageCompressionResult,
  ImageOutputFormat,
  formatBytes,
  outputFilename,
} from '../utils/imageCompression';
import MediaUpload from './MediaUpload';
import QualityPresets from './QualityPresets';
import ToolIcon from './ToolIcon';

export default function ImageCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<CompressionPreset>('quality');
  const [format, setFormat] = useState<ImageOutputFormat>('image/webp');
  const [dimension, setDimension] = useState('original');
  const [targetMB, setTargetMB] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [outputUrl, setOutputUrl] = useState('');
  const [result, setResult] = useState<ImageCompressionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!file) {
      setOriginalUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!result) {
      setOutputUrl('');
      return;
    }
    const url = URL.createObjectURL(result.blob);
    setOutputUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);
  useEffect(() => () => abortRef.current?.abort(), []);
  const resetResult = () => {
    setResult(null);
    setError('');
  };
  const selectFile = (next: File | null) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    resetResult();
    setFile(next);
  };
  const run = async () => {
    if (!file) return;
    if (
      targetMB &&
      (!Number.isFinite(Number(targetMB)) ||
        Number(targetMB) < 0.01 ||
        Number(targetMB) > 100)
    ) {
      setError('Enter a target between 0.01 and 100 MB.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    resetResult();
    try {
      const limit = dimension === 'original' ? undefined : Number(dimension);
      const output = await compressImage(
        file,
        {
          preset,
          format,
          maxWidth: limit,
          maxHeight: limit,
          targetBytes: targetMB
            ? Math.round(Number(targetMB) * 1024 * 1024)
            : undefined,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setResult(output);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : 'Could not process this image. Try another file.',
        );
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
        abortRef.current = null;
      }
    }
  };
  const saving =
    file && result ? Math.round((1 - result.blob.size / file.size) * 100) : 0;
  return (
    <div className="compressor-grid">
      <div className="workspace-column">
        <section className="workspace-panel">
          <div className="panel-heading">
            <span>
              <ToolIcon name="image" size={18} />
              Your image
            </span>
            <span className="subtle-tag">
              <span className="status-dot" />
              On your device
            </span>
          </div>
          {!file ? (
            <MediaUpload kind="image" onSelect={selectFile} />
          ) : (
            <>
              <div className="file-row">
                <span className="file-type">
                  <ToolIcon name="image" />
                </span>
                <span className="file-info">
                  <strong>{file.name}</strong>
                  <small>
                    {formatBytes(file.size)}
                    {result &&
                      ` · ${result.originalWidth} × ${result.originalHeight} px`}
                  </small>
                </span>
                <button
                  className="icon-button"
                  aria-label="Remove image"
                  onClick={() => selectFile(null)}
                  disabled={busy}
                >
                  <ToolIcon name="close" size={18} />
                </button>
              </div>
              <div className={`comparison ${result ? 'has-result' : ''}`}>
                <figure>
                  <figcaption>
                    <span>ORIGINAL</span>
                    <span>{formatBytes(file.size)}</span>
                  </figcaption>
                  <div className="image-stage">
                    {originalUrl && <img src={originalUrl} alt="Original" />}
                  </div>
                </figure>
                {result && (
                  <figure>
                    <figcaption>
                      <span>
                        {result.keptOriginal ? 'ORIGINAL KEPT' : 'COMPRESSED'}
                      </span>
                      <span>{formatBytes(result.blob.size)}</span>
                    </figcaption>
                    <div className="image-stage">
                      {outputUrl && (
                        <img
                          src={outputUrl}
                          alt="Compressed result for comparison"
                        />
                      )}
                    </div>
                  </figure>
                )}
              </div>
              {!result && !busy && (
                <p className="preview-caption">
                  Your original stays untouched. Choose your settings, then
                  compress.
                </p>
              )}
              {busy && (
                <div className="processing-note" role="status">
                  <span className="spinner" />
                  Finding a lighter version…
                </div>
              )}
              {result && (
                <div className="result-area" aria-live="polite">
                  <div className="result-head">
                    <span className="success-icon">
                      <ToolIcon name="check" />
                    </span>
                    <div>
                      <h3>
                        {saving > 0
                          ? `${saving}% smaller. Ready to go.`
                          : result.keptOriginal
                            ? 'Your original is already smaller.'
                            : 'Your image is ready.'}
                      </h3>
                      <p>
                        {formatBytes(file.size)}{' '}
                        <span aria-hidden="true">→</span>{' '}
                        {formatBytes(result.blob.size)} · {result.width} ×{' '}
                        {result.height} px
                      </p>
                    </div>
                  </div>
                  {result.warning && (
                    <p className="status-note">{result.warning}</p>
                  )}
                  {outputUrl && (
                    <a
                      className="primary-button download-button"
                      href={outputUrl}
                      download={outputFilename(
                        file.name,
                        format,
                        result.keptOriginal,
                      )}
                    >
                      <ToolIcon name="download" size={18} />
                      Download {result.keptOriginal ? 'original' : 'image'}
                      <span>{formatBytes(result.blob.size)}</span>
                    </a>
                  )}
                  <p className="help-text">
                    Compare the detail before you download. Re-encoding can
                    remove embedded metadata.
                  </p>
                </div>
              )}
            </>
          )}
          {error && (
            <p className="error-notice" role="alert">
              {error}
            </p>
          )}
          <div className="privacy-line">
            <ToolIcon name="shield" size={15} />
            <span>
              Private by design. Images are processed in your browser.
            </span>
          </div>
        </section>
        <div className="tip-row">
          <span className="tip-icon">
            <ToolIcon name="spark" size={20} />
          </span>
          <div>
            <h3>Less weight. More possibilities.</h3>
            <p>
              Keep original dimensions for the most detail. Resize when you only
              need a smaller image for a website or message.
            </p>
          </div>
        </div>
      </div>
      <aside className="settings-panel" aria-label="Image compression settings">
        <div className="panel-heading">
          <span>Make it yours</span>
          <ToolIcon name="spark" size={17} />
        </div>
        <div className="settings-body">
          <QualityPresets
            value={preset}
            onChange={(value) => {
              setPreset(value);
              resetResult();
            }}
            disabled={busy}
            lossless={format === 'image/png'}
          />
          <div className="settings-divider" />
          <label className="field">
            <span>Output format</span>
            <select
              value={format}
              disabled={busy}
              onChange={(event) => {
                setFormat(event.target.value as ImageOutputFormat);
                resetResult();
              }}
            >
              <option value="image/webp">WebP · recommended</option>
              <option value="image/jpeg">JPG · widely compatible</option>
              <option value="image/png">PNG · lossless encoding</option>
            </select>
          </label>
          <label className="field">
            <span>Image dimensions</span>
            <select
              value={dimension}
              disabled={busy}
              onChange={(event) => {
                setDimension(event.target.value);
                resetResult();
              }}
            >
              <option value="original">Keep original size</option>
              <option value="2560">Fit within 2560 × 2560 px</option>
              <option value="1920">Fit within 1920 × 1920 px</option>
              <option value="1280">Fit within 1280 × 1280 px</option>
              <option value="800">Fit within 800 × 800 px</option>
            </select>
            <small>Proportions stay the same. Never upscaled.</small>
          </label>
          <details className="advanced-settings">
            <summary>
              Have a file size in mind?<span>+</span>
            </summary>
            <label className="field">
              <span>Target file size (MB)</span>
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={targetMB}
                placeholder="Optional, e.g. 2"
                disabled={busy}
                onChange={(event) => {
                  setTargetMB(event.target.value);
                  resetResult();
                }}
              />
              <small>
                We try to reach it within your quality preset. Very small
                targets may not be possible.
              </small>
            </label>
          </details>
          <button
            className="primary-button compress-button"
            disabled={!file || busy}
            onClick={run}
          >
            {busy ? (
              <span className="spinner" />
            ) : (
              <ToolIcon name="spark" size={17} />
            )}{' '}
            {busy ? 'Compressing…' : 'Compress image'}
            {!busy && <ToolIcon name="arrow" size={17} />}
          </button>
          {busy && (
            <button
              className="secondary-button"
              onClick={() => {
                abortRef.current?.abort();
                setBusy(false);
              }}
            >
              Cancel
            </button>
          )}
          <p className="settings-footnote">
            Smaller files, with you in control.
            <br />
            Quality and savings depend on your image.
          </p>
        </div>
      </aside>
    </div>
  );
}
