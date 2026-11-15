import React, { useEffect, useRef, useState } from 'react';
import MediaUpload from './MediaUpload';
import QualityPresets from './QualityPresets';
import ToolIcon from './ToolIcon';
import { CompressionPreset, formatBytes } from '../utils/imageCompression';
import {
  deleteVideoJob,
  getVideoJob,
  getVideoService,
  uploadVideo,
  videoDownloadUrl,
  videoPreviewUrl,
  waitForVideoPoll,
  VideoJob,
  VideoJobIdentity,
  VideoService,
  VideoRequestError,
} from '../utils/videoClient';

type Phase =
  | 'idle'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelling';
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';

export default function VideoCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [preset, setPreset] = useState<CompressionPreset>('quality');
  const [maxHeight, setMaxHeight] = useState(0);
  const [target, setTarget] = useState('');
  const [consent, setConsent] = useState(false);
  const [service, setService] = useState<VideoService>();
  const [serviceError, setServiceError] = useState('');
  const [checking, setChecking] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [job, setJob] = useState<VideoJob>();
  const [identity, setIdentity] = useState<VideoJobIdentity>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const controller = useRef<AbortController>();
  const jobRef = useRef<VideoJobIdentity>();
  const generation = useRef(0);
  const mounted = useRef(true);
  const healthController = useRef<AbortController>();
  const busy =
    phase === 'uploading' || phase === 'processing' || phase === 'cancelling';
  const targetMB = target.trim() === '' ? undefined : Number(target);
  const targetValid =
    targetMB === undefined ||
    (Number.isInteger(targetMB) && targetMB >= 1 && targetMB <= 10240);
  const limit = service?.maxFileBytes ?? 10 * 1024 ** 3;

  const checkService = async () => {
    healthController.current?.abort();
    const request = new AbortController();
    healthController.current = request;
    const timer = window.setTimeout(() => request.abort(), 10000);
    setChecking(true);
    setServiceError('');
    try {
      const response = await getVideoService(request.signal);
      if (!mounted.current || healthController.current !== request) return;
      setService(response);
      if (!response.available)
        setServiceError(
          'Video processing is unavailable right now. Please try again shortly.',
        );
    } catch {
      if (mounted.current && healthController.current === request) {
        setService(undefined);
        setServiceError(
          'Video processing is unavailable right now. Your file has not been uploaded.',
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (mounted.current && healthController.current === request)
        setChecking(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    checkService();
    return () => {
      mounted.current = false;
      generation.current += 1;
      healthController.current?.abort();
      controller.current?.abort();
      if (jobRef.current)
        void deleteVideoJob(jobRef.current).catch(() => undefined);
    };
    // Service discovery runs once when this workspace mounts; retry is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    setPreviewFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const selectFile = (next: File) => {
    if (busy) return;
    setError('');
    setNotice('');
    if (!next.size) {
      setError('Choose a video that is not empty.');
      return;
    }
    if (next.size > limit) {
      setError(`Choose a video smaller than ${formatBytes(limit)}.`);
      return;
    }
    if (
      !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(next.name) &&
      !next.type.startsWith('video/')
    ) {
      setError('Choose an MP4, MOV, WebM, MKV, or AVI video.');
      return;
    }
    if (jobRef.current)
      void deleteVideoJob(jobRef.current).catch(() => undefined);
    jobRef.current = undefined;
    setIdentity(undefined);
    setJob(undefined);
    setPhase('idle');
    setShowResult(false);
    setConsent(false);
    setFile(next);
  };

  const poll = async (
    currentJob: VideoJobIdentity,
    request: AbortController,
    run: number,
  ) => {
    let failures = 0;
    while (!request.signal.aborted && generation.current === run) {
      let status: VideoJob;
      try {
        status = await getVideoJob(currentJob, request.signal);
        failures = 0;
      } catch (failure) {
        if (request.signal.aborted) throw failure;
        if (
          failure instanceof VideoRequestError &&
          [401, 403, 404].includes(failure.status)
        ) {
          if (mounted.current && generation.current === run) {
            jobRef.current = undefined;
            setIdentity(undefined);
            setJob(undefined);
          }
          throw new Error(
            'This video job has expired or is no longer available. Choose “Compress video” to start again.',
          );
        }
        failures += 1;
        if (failures >= 3)
          throw new Error(
            'Connection lost while checking progress. Your video may still be processing. Use “Check progress” to reconnect.',
          );
        await waitForVideoPoll(request.signal, 2000);
        continue;
      }
      if (!mounted.current || generation.current !== run) return;
      setJob(status);
      if (status.status === 'completed') {
        setPhase('completed');
        setShowResult(true);
        setPreviewFailed(false);
        return;
      }
      if (status.status === 'failed')
        throw new Error(
          status.error ||
            'This video could not be processed. Try another format or a smaller file.',
        );
      if (status.status === 'cancelled') {
        setPhase('idle');
        setNotice('Processing cancelled.');
        return;
      }
      await waitForVideoPoll(request.signal);
    }
  };

  const start = async () => {
    if (!file || !consent || !service?.available || busy || !targetValid)
      return;
    const run = ++generation.current;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setError('');
    setNotice('');
    setShowResult(false);
    setPhase('uploading');
    setUploadProgress(0);
    try {
      if (jobRef.current) {
        await deleteVideoJob(jobRef.current);
        jobRef.current = undefined;
        setIdentity(undefined);
        setJob(undefined);
      }
      if (request.signal.aborted || generation.current !== run) return;
      const created = await uploadVideo(
        file,
        { preset, maxHeight, targetMB },
        (percent) => {
          if (mounted.current && generation.current === run)
            setUploadProgress(percent);
        },
        request.signal,
      );
      if (
        !mounted.current ||
        generation.current !== run ||
        request.signal.aborted
      ) {
        void deleteVideoJob(created).catch(() => undefined);
        return;
      }
      jobRef.current = created;
      setIdentity(created);
      setPhase('processing');
      await poll(created, request, run);
    } catch (failure) {
      if (
        mounted.current &&
        generation.current === run &&
        !request.signal.aborted
      ) {
        setError(errorMessage(failure));
        setPhase('error');
      }
    }
  };

  const reconnect = async () => {
    if (!jobRef.current || busy) return;
    const run = ++generation.current;
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setError('');
    setPhase('processing');
    try {
      await poll(jobRef.current, request, run);
    } catch (failure) {
      if (
        mounted.current &&
        generation.current === run &&
        !request.signal.aborted
      ) {
        setError(errorMessage(failure));
        setPhase('error');
      }
    }
  };

  const clearJob = async () => {
    const knownJob = jobRef.current;
    generation.current += 1;
    controller.current?.abort();
    setPhase('cancelling');
    setError('');
    try {
      if (knownJob) await deleteVideoJob(knownJob);
      if (!mounted.current) return;
      jobRef.current = undefined;
      setIdentity(undefined);
      setJob(undefined);
      setShowResult(false);
      setPhase('idle');
      setNotice(
        knownJob
          ? 'Server files deleted. Your original is unchanged.'
          : 'Upload cancelled. Any temporary server files are removed automatically.',
      );
    } catch {
      if (mounted.current) {
        setPhase('error');
        setError(
          'Could not confirm deletion. Try “Delete server files” again; automatic cleanup still applies.',
        );
      }
    }
  };

  const percentage = Math.max(
    0,
    Math.min(
      100,
      phase === 'uploading' ? uploadProgress : (job?.progress ?? 0),
    ),
  );
  const savings =
    job?.outputBytes !== undefined && job.inputBytes > 0
      ? Math.round((1 - job.outputBytes / job.inputBytes) * 100)
      : undefined;
  const progressLabel =
    phase === 'uploading'
      ? uploadProgress === 100
        ? 'Upload complete. Preparing your video…'
        : 'Uploading your video…'
      : job?.status === 'queued'
        ? 'Waiting for an available processor…'
        : 'Compressing your video…';

  return (
    <div className="compressor-grid">
      <section className="workspace-panel" aria-label="Video workspace">
        <div className="panel-heading">
          <h2>Your video</h2>
          <span className="section-label">MP4 OUTPUT</span>
        </div>
        {!file ? (
          <MediaUpload
            kind="video"
            onSelect={selectFile}
            maxBytes={limit}
            disabled={busy}
          />
        ) : (
          <>
            <div className="file-row">
              <span className="file-type-icon">
                <ToolIcon name="video" size={22} />
              </span>
              <div className="file-info">
                <strong title={file.name}>{file.name}</strong>
                <span>{formatBytes(file.size)} · Original file</span>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (jobRef.current)
                    void deleteVideoJob(jobRef.current).catch(() => undefined);
                  jobRef.current = undefined;
                  setIdentity(undefined);
                  setJob(undefined);
                  setFile(null);
                  setConsent(false);
                  setPhase('idle');
                  setError('');
                  setNotice('');
                }}
              >
                Change file
              </button>
            </div>
            {phase === 'completed' && identity && (
              <div className="preview-toggle" aria-label="Video preview">
                <button
                  type="button"
                  aria-pressed={!showResult}
                  onClick={() => {
                    setShowResult(false);
                    setPreviewFailed(false);
                  }}
                >
                  Original
                </button>
                <button
                  type="button"
                  aria-pressed={showResult}
                  onClick={() => {
                    setShowResult(true);
                    setPreviewFailed(false);
                  }}
                >
                  Compressed
                </button>
              </div>
            )}
            <div className="preview-stage video-preview">
              {preview && (
                <video
                  key={showResult && identity ? identity.id : preview}
                  src={
                    showResult && identity ? videoPreviewUrl(identity) : preview
                  }
                  controls
                  preload="metadata"
                  playsInline
                  onError={() => setPreviewFailed(true)}
                  aria-label={
                    showResult
                      ? 'Compressed video preview'
                      : 'Original video preview'
                  }
                />
              )}
            </div>
            {previewFailed && (
              <p className="status-note">
                This browser cannot preview this video.{' '}
                {showResult
                  ? 'Download it to review in your video player.'
                  : 'You can still try compressing it to MP4.'}
              </p>
            )}
          </>
        )}

        {busy && (
          <div className="processing-state" aria-live="polite">
            <div className="progress-heading">
              <strong>
                {phase === 'cancelling'
                  ? 'Clearing server files…'
                  : progressLabel}
              </strong>
              {phase !== 'cancelling' && <span>{percentage}%</span>}
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={progressLabel}
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${percentage}%` }} />
            </div>
            <p className="help-text">
              Keep this page open. Large videos can take several minutes.
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={clearJob}
              disabled={phase === 'cancelling'}
            >
              Cancel processing
            </button>
          </div>
        )}

        {phase === 'completed' && job && identity && (
          <div className="compression-result" aria-live="polite">
            <div className="result-heading">
              <h3>Your video is ready</h3>
              <span className="savings-badge">
                {savings !== undefined && savings > 0
                  ? `${savings}% smaller`
                  : 'Size comparison'}
              </span>
            </div>
            <div className="result-stats">
              <div>
                <span>Original</span>
                <strong>{formatBytes(job.inputBytes)}</strong>
              </div>
              <ToolIcon name="arrow" size={20} />
              <div>
                <span>Compressed</span>
                <strong>{formatBytes(job.outputBytes ?? 0)}</strong>
              </div>
            </div>
            <p className="help-text">
              MP4 · {job.width} × {job.height} px
              {job.duration ? ` · ${Math.round(job.duration)} seconds` : ''}
            </p>
            {savings !== undefined && savings <= 0 && (
              <p className="status-note">
                This source is already efficiently compressed. The output is not
                smaller; keep your original or try a different setting.
              </p>
            )}
            {job.warning && <p className="status-note">{job.warning}</p>}
            <a
              className="primary-button"
              href={videoDownloadUrl(identity)}
              download
              rel="noreferrer"
            >
              <ToolIcon name="download" size={18} />
              Download MP4
            </a>
            <p className="help-text">
              Available for up to {service?.retentionMinutes ?? 60} minutes
              after processing. The server copy is automatically deleted.
            </p>
            <button type="button" className="text-button" onClick={clearJob}>
              Delete server files
            </button>
          </div>
        )}
        {error && (
          <div className="error-notice" role="alert">
            <p>{error}</p>
            {identity && (
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={reconnect}
                >
                  Check progress
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={clearJob}
                >
                  Delete server files
                </button>
              </div>
            )}
          </div>
        )}
        {notice && (
          <p className="status-note" role="status">
            {notice}
          </p>
        )}
        <div className="privacy-line">
          <ToolIcon name="shield" size={16} />
          <span>
            Videos are processed on the server. Your original file stays
            unchanged.
          </span>
        </div>
      </section>

      <aside className="settings-panel" aria-label="Video compression settings">
        <div className="panel-heading">
          <h2>Make it yours</h2>
          <ToolIcon name="resize" size={18} />
        </div>
        <div className="settings-section">
          <span className="section-label">COMPRESSION</span>
          <QualityPresets
            value={preset}
            onChange={setPreset}
            disabled={busy || targetMB !== undefined}
          />
          <p className="help-text">
            Best quality keeps more detail. Smaller files trade some detail for
            size. Compression is not lossless.
          </p>
        </div>
        <div className="settings-section">
          <label className="field" htmlFor="video-resolution">
            <span>Maximum resolution</span>
            <select
              id="video-resolution"
              value={maxHeight}
              disabled={busy}
              onChange={(event) => setMaxHeight(Number(event.target.value))}
            >
              <option value={0}>Keep original resolution</option>
              <option value={2160}>Up to 4K · 2160p</option>
              <option value={1080}>Up to Full HD · 1080p</option>
              <option value={720}>Up to HD · 720p</option>
            </select>
          </label>
          <p className="help-text">
            Keeps the aspect ratio. Smaller videos are never enlarged.
          </p>
        </div>
        <div className="settings-section">
          <label className="field" htmlFor="video-target">
            <span>
              Target file size <small>Optional</small>
            </span>
            <div className="input-with-unit">
              <input
                id="video-target"
                type="number"
                min={1}
                max={10240}
                step={1}
                value={target}
                disabled={busy}
                placeholder="No target"
                aria-invalid={!targetValid}
                aria-describedby="video-target-help"
                onChange={(event) => setTarget(event.target.value)}
              />
              <span>MB</span>
            </div>
          </label>
          <p className="help-text" id="video-target-help">
            {targetMB !== undefined
              ? 'A target overrides the quality preset. Very small targets can noticeably reduce quality; final size may vary.'
              : 'Leave empty to prioritize quality. Add a target for attachment or upload limits.'}
          </p>
          {!targetValid && (
            <p className="error-text">
              Enter a whole number from 1 to 10,240 MB.
            </p>
          )}
        </div>
        <div className="video-consent">
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || !file}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>I agree to upload this video for processing.</span>
          </label>
          <p className="help-text">
            Server copies are deleted automatically{' '}
            {service?.retentionMinutes ?? 60} minutes after processing finishes,
            or when you clear them.
          </p>
        </div>
        {!checking && serviceError && (
          <div className="status-note">
            <p>{serviceError}</p>
            <button
              type="button"
              className="text-button"
              onClick={checkService}
            >
              Try again
            </button>
          </div>
        )}
        <button
          type="button"
          className="primary-button"
          onClick={start}
          disabled={
            !file ||
            !consent ||
            !service?.available ||
            busy ||
            !targetValid ||
            checking
          }
        >
          <ToolIcon name="spark" size={18} />
          {checking
            ? 'Checking video service…'
            : busy
              ? 'Processing video…'
              : 'Compress video'}
        </button>
        <p className="settings-footnote">
          {formatBytes(limit)} maximum · MP4 output · Keeps available audio
        </p>
      </aside>
    </div>
  );
}
