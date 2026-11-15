export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

export const validateImageDimensions = (width: number, height: number): void => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 50_000_000) {
    throw new Error('Use whole-number dimensions from 1 to 16,384 pixels, up to 50 megapixels.');
  }
};

export const ASPECT_RATIOS = {
  '1:1': { width: 1, height: 1, description: 'Square (Instagram Post)' },
  '4:5': { width: 4, height: 5, description: 'Portrait (Instagram Feed)' },
  '16:9': { width: 16, height: 9, description: 'Widescreen (YouTube)' },
  '3:2': { width: 3, height: 2, description: 'Landscape (Photography)' },
  '9:16': { width: 9, height: 16, description: 'Vertical (Instagram Stories)' },
  '4:3': { width: 4, height: 3, description: 'Standard (Classic TV)' },
} as const;

export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

export const validateImageFile = (file: File): { isValid: boolean; error?: string } => {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return {
      isValid: false,
      error: 'Unsupported file type. Choose a PNG, JPG, WebP, or SVG image.'
    };
  }

  // Check file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size === 0) return { isValid: false, error: 'This file is empty. Choose another image.' };
  if (file.size > maxSize) {
    return {
      isValid: false,
      error: `File too large. Please upload files smaller than 50MB.`
    };
  }

  return { isValid: true };
};

export const getImagePreviewUrl = (file: File): string => {
  return URL.createObjectURL(file);
};

export const calculateDimensionsFromAspectRatio = (
  originalWidth: number,
  originalHeight: number,
  aspectRatio: AspectRatioKey,
  maxWidth = 1920
): { width: number; height: number } => {
  validateImageDimensions(originalWidth, originalHeight);
  if (!Number.isFinite(maxWidth) || maxWidth < 1) throw new Error('Invalid maximum dimension.');
  const ratio = ASPECT_RATIOS[aspectRatio];
  const aspectRatioValue = ratio.width / ratio.height;

  // A preset is a bounded canvas. Content is fitted inside it without stretching.
  const longestSide = Math.min(Math.floor(maxWidth), Math.max(originalWidth, originalHeight), 16384);
  const width = Math.max(1, Math.round(aspectRatioValue >= 1 ? longestSide : longestSide * aspectRatioValue));
  const height = Math.max(1, Math.round(aspectRatioValue >= 1 ? longestSide / aspectRatioValue : longestSide));
  validateImageDimensions(width, height);
  return { width, height };
};

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const getFileExtension = (filename: string): string => {
  return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
};

export const generateFileName = (originalName: string, suffix?: string, extension?: string): string => {
  const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
  const ext = extension || getFileExtension(originalName);
  const suffixPart = suffix ? `_${suffix}` : '';
  
  return `${nameWithoutExt}${suffixPart}.${ext}`;
};

export const handlePasteImage = (event: ClipboardEvent): File | null => {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) {
        // Create a new file with a proper name
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = item.type.split('/')[1];
        const newFile = new File([file], `pasted-image-${timestamp}.${extension}`, {
          type: item.type
        });
        return newFile;
      }
    }
  }
  
  return null;
};
