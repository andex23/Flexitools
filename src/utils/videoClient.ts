import { CompressionPreset } from './imageCompression';

export interface VideoService {
  available: boolean;
  maxFileBytes: number;
  retentionMinutes: number;
  message?: string;
}

export interface VideoJobIdentity {
  id: string;
  token: string;
}

export interface VideoJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  filename: string;
  inputBytes: number;
  outputBytes?: number;
  width?: number;
  height?: number;
  duration?: number;
  error?: string;
  warning?: string;
  expiresAt?: number | string;
}

export interface VideoOptions {
  preset: CompressionPreset;
  maxHeight: number;
  targetMB?: number;
}

const serviceUnavailable =
  'Video processing is unavailable right now. Please try again shortly. Your file has not been uploaded.';
const cancelled = () =>
  new DOMException('Video processing cancelled.', 'AbortError');

export class VideoRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'VideoRequestError';
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'The video service returned an unexpected response. Please try again.',
    );
  }
  if (!response.ok)
    throw new VideoRequestError(
      body?.error || 'The video request could not be completed.',
      response.status,
    );
  return body as T;
}

export async function getVideoService(
  signal?: AbortSignal,
): Promise<VideoService> {
  try {
    const data = await readResponse<VideoService>(
      await fetch('/api/health', { signal, cache: 'no-store' }),
    );
    if (
      typeof data.available !== 'boolean' ||
      !Number.isFinite(data.maxFileBytes) ||
      !Number.isFinite(data.retentionMinutes)
    ) {
      throw new Error(serviceUnavailable);
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    throw new Error(serviceUnavailable);
  }
}

/** XHR sends the File directly; large videos never become an ArrayBuffer or a base64 string. */
export function uploadVideo(
  file: File,
  options: VideoOptions,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<VideoJobIdentity> {
  if (signal?.aborted) return Promise.reject(cancelled());
  const params = new URLSearchParams({
    filename: file.name,
    preset: options.preset,
    maxHeight: String(options.maxHeight),
  });
  if (options.targetMB !== undefined)
    params.set('targetMB', String(options.targetMB));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    request.open('POST', `/api/jobs?${params}`);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
    };
    request.onload = () => {
      cleanup();
      const data = request.response;
      if (request.status < 200 || request.status >= 300) {
        reject(
          new Error(
            data?.error || 'The video upload failed. Please try again.',
          ),
        );
      } else if (
        typeof data?.id !== 'string' ||
        typeof data?.token !== 'string'
      ) {
        reject(
          new Error(
            'The video service returned an unexpected response. Please try again.',
          ),
        );
      } else {
        resolve({ id: data.id, token: data.token });
      }
    };
    request.onerror = () => {
      cleanup();
      reject(
        new Error(
          'The upload was interrupted. Check your connection and try again.',
        ),
      );
    };
    request.onabort = () => {
      cleanup();
      reject(cancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
    onProgress(0);
    request.send(file);
  });
}

export async function getVideoJob(
  identity: VideoJobIdentity,
  signal?: AbortSignal,
): Promise<VideoJob> {
  return readResponse<VideoJob>(
    await fetch(`/api/jobs/${encodeURIComponent(identity.id)}`, {
      headers: { Authorization: `Bearer ${identity.token}` },
      signal,
      cache: 'no-store',
    }),
  );
}

export async function deleteVideoJob(
  identity: VideoJobIdentity,
): Promise<void> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(identity.id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${identity.token}` },
    keepalive: true,
  });
  if (response.status !== 204 && response.status !== 404)
    await readResponse(response);
}

export function videoDownloadUrl(identity: VideoJobIdentity): string {
  return `/api/jobs/${encodeURIComponent(identity.id)}/download?token=${encodeURIComponent(identity.token)}`;
}

export function videoPreviewUrl(identity: VideoJobIdentity): string {
  return `/api/jobs/${encodeURIComponent(identity.id)}/preview?token=${encodeURIComponent(identity.token)}`;
}

export function waitForVideoPoll(
  signal: AbortSignal,
  milliseconds = 1200,
): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(cancelled());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
