import { fitImageDimensions, ImageOutputFormat, readImageMetadata } from './imageCompression';

export interface CropRectangle { x: number; y: number; width: number; height: number }
export type ImageRotation = 0 | 90 | 180 | 270;
export interface ImageWatermark {
  text: string;
  position: 'bottom-right' | 'center';
  opacity: number;
  sizePercent: number;
}
export interface ImageEditOptions {
  mode: 'edit' | 'metadata';
  format: ImageOutputFormat;
  crop?: CropRectangle;
  rotation?: ImageRotation;
  watermark?: ImageWatermark;
}
export interface ImageEditResult {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  warning: string;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Image editing cancelled.', 'AbortError');
}

export function getEditGeometry(width: number, height: number, crop?: CropRectangle, rotation: ImageRotation = 0) {
  fitImageDimensions(width, height);
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Choose a rotation in 90-degree steps.');
  const selection = crop ?? { x: 0, y: 0, width, height };
  if (![selection.x, selection.y, selection.width, selection.height].every(Number.isSafeInteger)
    || selection.x < 0 || selection.y < 0 || selection.width < 1 || selection.height < 1
    || selection.x + selection.width > width || selection.y + selection.height > height) {
    throw new Error('The crop must use whole pixels and stay inside the original image.');
  }
  return {
    crop: selection,
    width: rotation === 90 || rotation === 270 ? selection.height : selection.width,
    height: rotation === 90 || rotation === 270 ? selection.width : selection.height,
    rotation,
  };
}

export function normalizeWatermark(watermark?: ImageWatermark): ImageWatermark | undefined {
  if (!watermark || !watermark.text.trim()) return undefined;
  const clean = Array.from(watermark.text, character => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').trim();
  const text = Array.from(clean).slice(0, 100).join('');
  if (!text) return undefined;
  if (!['bottom-right', 'center'].includes(watermark.position)) throw new Error('Choose a valid watermark position.');
  if (!Number.isFinite(watermark.opacity) || watermark.opacity < 0.1 || watermark.opacity > 1) throw new Error('Watermark opacity must be between 10% and 100%.');
  if (!Number.isFinite(watermark.sizePercent) || watermark.sizePercent < 1 || watermark.sizePercent > 15) throw new Error('Watermark size must be between 1% and 15%.');
  return { ...watermark, text };
}

async function decodeEditableImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  await readImageMetadata(file, signal);
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const clean = () => {
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', abort);
      img.onload = null;
      img.onerror = null;
    };
    const abort = () => { clean(); img.src = ''; reject(new DOMException('Image editing cancelled.', 'AbortError')); };
    img.onload = () => {
      clean();
      try { fitImageDimensions(img.naturalWidth, img.naturalHeight); resolve(img); }
      catch (error) { img.src = ''; reject(error); }
    };
    img.onerror = () => { clean(); img.src = ''; reject(new Error('Your browser cannot decode this file. Try a still JPG, PNG, or WebP.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    img.src = url;
  });
}

/** Uses decoded dimensions, including browser-applied EXIF orientation, for crop coordinates. */
export async function inspectImageForEditing(file: File, signal?: AbortSignal) {
  const image = await decodeEditableImage(file, signal);
  try { checkAbort(signal); return { width: image.naturalWidth, height: image.naturalHeight }; }
  finally { image.src = ''; }
}

function encode(canvas: HTMLCanvasElement, format: ImageOutputFormat, signal?: AbortSignal): Promise<Blob> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Image editing cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob(blob => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { abort(); return; }
        if (!blob) { reject(new Error('Could not export this image. Try a smaller crop.')); return; }
        if (blob.type !== format) { reject(new Error('Your browser cannot export this format. Choose JPG or PNG.')); return; }
        resolve(blob);
      }, format, format === 'image/png' ? 1 : 0.94);
    } catch (error) { signal?.removeEventListener('abort', abort); reject(error); }
  });
}

/** Rebuilds pixels in a new canvas. Source EXIF/XMP/IPTC metadata is never copied. */
export async function editImage(file: File, options: ImageEditOptions, signal?: AbortSignal): Promise<ImageEditResult> {
  checkAbort(signal);
  if (!['edit', 'metadata'].includes(options.mode)) throw new Error('Choose an editing mode.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(options.format)) throw new Error('Choose JPG, PNG, or WebP output.');
  const watermark = options.mode === 'edit' ? normalizeWatermark(options.watermark) : undefined;
  const image = await decodeEditableImage(file, signal);
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkAbort(signal);
    const originalWidth = image.naturalWidth;
    const originalHeight = image.naturalHeight;
    const geometry = getEditGeometry(originalWidth, originalHeight, options.mode === 'edit' ? options.crop : undefined, options.mode === 'edit' ? options.rotation : 0);
    canvas = document.createElement('canvas');
    canvas.width = geometry.width;
    canvas.height = geometry.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not create an editing canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (options.format === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(geometry.rotation * Math.PI / 180);
    const { x, y, width, height } = geometry.crop;
    context.drawImage(image, x, y, width, height, -width / 2, -height / 2, width, height);
    context.restore();
    if (watermark) {
      const shorterSide = Math.min(canvas.width, canvas.height);
      const margin = shorterSide * 0.025;
      let fontSize = Math.max(1, shorterSide * watermark.sizePercent / 100);
      context.font = `600 ${fontSize}px sans-serif`;
      const measured = context.measureText(watermark.text).width;
      if (measured > canvas.width - margin * 2) fontSize *= Math.max(0.01, (canvas.width - margin * 2) / measured);
      context.font = `600 ${fontSize}px sans-serif`;
      context.globalAlpha = watermark.opacity;
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#17251c';
      context.lineWidth = Math.max(0.5, fontSize * 0.06);
      context.lineJoin = 'round';
      context.textAlign = watermark.position === 'center' ? 'center' : 'right';
      context.textBaseline = watermark.position === 'center' ? 'middle' : 'bottom';
      const textX = watermark.position === 'center' ? canvas.width / 2 : canvas.width - margin;
      const textY = watermark.position === 'center' ? canvas.height / 2 : canvas.height - margin;
      context.strokeText(watermark.text, textX, textY);
      context.fillText(watermark.text, textX, textY);
      context.globalAlpha = 1;
    }
    const blob = await encode(canvas, options.format, signal);
    checkAbort(signal);
    return {
      blob, width: canvas.width, height: canvas.height, originalWidth, originalHeight,
      warning: `Source location, camera, and other embedded metadata are not copied. Re-encoding can change colors and file size${options.format === 'image/png' ? '; PNG export does not introduce lossy compression.' : ' and may slightly reduce quality.'}${options.format === 'image/jpeg' ? ' Transparency is flattened onto white for JPG.' : ''}`,
    };
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    image.src = '';
  }
}

export function editedFilename(name: string, format: ImageOutputFormat, mode: ImageEditOptions['mode']) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[format];
  const stem = name.replace(/\.[^/.]+$/, '') || 'image';
  return `${stem}-${mode === 'metadata' ? 'metadata-removed' : 'edited'}.${extension}`;
}
