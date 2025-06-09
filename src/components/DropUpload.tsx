import React, { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { validateImageFile, getImagePreviewUrl, formatFileSize, handlePasteImage } from '../utils/imageHelpers';

interface DropUploadProps {
  onFileUpload: (file: File) => void;
  uploadedFile: File | null;
}

const DropUpload: React.FC<DropUploadProps> = ({ onFileUpload, uploadedFile }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const validation = validateImageFile(file);
      
      if (!validation.isValid) {
        toast.error(validation.error!);
        return;
      }
      
      onFileUpload(file);
      toast.success('Image uploaded successfully!');
    }
  }, [onFileUpload]);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject
  } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.bmp', '.tiff', '.webp']
    },
    multiple: false,
    maxSize: 50 * 1024 * 1024 // 50MB
  });

  // Handle clipboard paste
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = handlePasteImage(event);
      if (file) {
        const validation = validateImageFile(file);
        
        if (!validation.isValid) {
          toast.error(validation.error!);
          return;
        }
        
        onFileUpload(file);
        toast.success('Image pasted successfully!');
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [onFileUpload]);

  // Update preview when file changes
  useEffect(() => {
    if (uploadedFile) {
      const url = getImagePreviewUrl(uploadedFile);
      setPreviewUrl(url);
      
      return () => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
      };
    } else {
      setPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedFile]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <div className="w-full">
      {!uploadedFile ? (
        <div
          {...getRootProps()}
          className={`
            relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
            ${isDragActive && !isDragReject ? 'border-ink bg-ink bg-opacity-5 ring-2 ring-matcha ring-offset-2 scale-105' : ''}
            ${isDragReject ? 'border-rose bg-rose bg-opacity-10' : ''}
            ${!isDragActive ? 'border-creamline hover:border-matcha hover:bg-matcha hover:bg-opacity-10' : ''}
          `}
        >
          <input {...getInputProps()} />
          
          <div className="flex flex-col items-center space-y-4">
            <div className="text-4xl">
              {isDragActive ? '📤' : '📁'}
            </div>
            
            <div>
              <p className="text-lg font-medium text-graphite font-heading">
                {isDragActive ? 'Drop your image here' : 'Upload an image'}
              </p>
              <p className="text-sm text-mist mt-1 font-body">
                Drag & drop, click to browse, or paste (Ctrl+V)
              </p>
            </div>
            
            <div className="text-xs text-mist font-body">
              Supports PNG, JPG, SVG, GIF, BMP, TIFF, WebP files up to 50MB
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-taupe rounded-xl border border-creamline p-4 shadow-md">
          <div className="flex flex-col md:flex-row md:items-start space-y-4 md:space-y-0 md:space-x-6">
            {/* Image Preview */}
            <div className="flex-shrink-0">
              <div className="w-32 h-32 bg-matcha bg-opacity-10 rounded-xl overflow-hidden border border-creamline">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full h-full object-cover transition-all duration-200 hover:scale-105"
                  />
                )}
              </div>
            </div>
            
            {/* File Info */}
            <div className="flex-grow min-w-0">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-graphite font-heading truncate">
                    {uploadedFile.name}
                  </p>
                  <p className="text-sm text-mist font-body">
                    {formatFileSize(uploadedFile.size)} • {uploadedFile.type}
                  </p>
                </div>
                
                <button
                  onClick={() => {
                    onFileUpload(null as any); // Clear the file
                    setPreviewUrl(null);
                  }}
                  className="ml-2 text-mist hover:text-rose hover:scale-110 transition-all duration-200"
                  title="Remove image"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="mt-3">
                <div {...getRootProps()}>
                  <input {...getInputProps()} />
                  <button
                    className="inline-flex items-center px-3 py-1 border border-creamline rounded-xl text-sm text-graphite bg-milk hover:bg-matcha hover:bg-opacity-20 hover:scale-105 transition-all duration-200 font-body cursor-pointer"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Replace
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DropUpload; 