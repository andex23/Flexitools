export interface ResizeOptions {
  width: number;
  height: number;
  maintainAspectRatio?: boolean;
}

export interface ConvertOptions {
  format: 'png' | 'jpeg';
  quality?: number;
}

export const loadImageFromFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
};

export const loadImageFromUrl = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image from URL'));
    
    img.src = url;
  });
};

export const resizeImage = (img: HTMLImageElement, options: ResizeOptions): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  
  const { width, height, maintainAspectRatio = false } = options;
  
  if (maintainAspectRatio) {
    const aspectRatio = img.width / img.height;
    const targetAspectRatio = width / height;
    
    if (aspectRatio > targetAspectRatio) {
      canvas.width = width;
      canvas.height = width / aspectRatio;
    } else {
      canvas.width = height * aspectRatio;
      canvas.height = height;
    }
  } else {
    canvas.width = width;
    canvas.height = height;
  }
  
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export const convertImage = (img: HTMLImageElement, options: ConvertOptions): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Could not get canvas context');
  }
  
  canvas.width = img.width;
  canvas.height = img.height;
  
  // Set white background for JPEG conversion
  if (options.format === 'jpeg') {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  
  ctx.drawImage(img, 0, 0);
  return canvas;
};

export const renderSvgToCanvas = (svgString: string, width: number, height: number): Promise<HTMLCanvasElement> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }
    
    canvas.width = width;
    canvas.height = height;
    
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG'));
    };
    
    img.src = url;
  });
};

export const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create blob from canvas'));
      }
    }, type, quality);
  });
};

export const downloadImage = (canvas: HTMLCanvasElement, filename: string, format: string, quality?: number) => {
  const link = document.createElement('a');
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  
  canvas.toBlob((blob) => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }, mimeType, quality);
}; 