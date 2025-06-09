import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { PDFDocument, PageSizes, rgb } from 'pdf-lib';
import mammoth from 'mammoth';

interface ToPdfProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

const SUPPORTED_TYPES = {
  images: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  documents: ['text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
};

const ALL_SUPPORTED_TYPES = [...SUPPORTED_TYPES.images, ...SUPPORTED_TYPES.documents];

const ToPdf: React.FC<ToPdfProps> = ({ files, onFilesChange }) => {
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => {
      if (ALL_SUPPORTED_TYPES.includes(file.type)) {
        return true;
      } else {
        toast.error(`Unsupported file type: ${file.name}`);
        return false;
      }
    });

    if (validFiles.length > 0) {
      onFilesChange([...files, ...validFiles]);
      toast.success(`Added ${validFiles.length} file(s)`);
    }
  }, [files, onFilesChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp'],
      'text/plain': ['.txt'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  });

  const removeFile = (index: number) => {
    const newFiles = files.filter((_, i) => i !== index);
    onFilesChange(newFiles);
    toast.success('File removed');
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    const newFiles = [...files];
    const [movedFile] = newFiles.splice(fromIndex, 1);
    newFiles.splice(toIndex, 0, movedFile);
    onFilesChange(newFiles);
  };

  const loadImageAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      console.error('Error extracting text from DOCX:', error);
      throw new Error('Failed to extract text from DOCX file');
    }
  };

  const extractTextFromTxt = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const createPdfFromFiles = async (): Promise<Uint8Array> => {
    const pdfDoc = await PDFDocument.create();

    for (const file of files) {
      if (SUPPORTED_TYPES.images.includes(file.type)) {
        // Handle images
        const imageDataUrl = await loadImageAsDataUrl(file);
        const imageBytes = await fetch(imageDataUrl).then(res => res.arrayBuffer());
        
        let image;
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
          image = await pdfDoc.embedJpg(imageBytes);
        } else if (file.type === 'image/png') {
          image = await pdfDoc.embedPng(imageBytes);
        } else {
          // Convert other formats to PNG first
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          
          await new Promise((resolve) => {
            img.onload = resolve;
            img.src = imageDataUrl;
          });
          
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          
          const pngDataUrl = canvas.toDataURL('image/png');
          const pngBytes = await fetch(pngDataUrl).then(res => res.arrayBuffer());
          image = await pdfDoc.embedPng(pngBytes);
        }

        const page = pdfDoc.addPage();
        const { width: pageWidth, height: pageHeight } = page.getSize();
        const { width: imgWidth, height: imgHeight } = image.scale(1);
        
        // Scale image to fit page while maintaining aspect ratio
        const scale = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
        const scaledWidth = imgWidth * scale;
        const scaledHeight = imgHeight * scale;
        
        page.drawImage(image, {
          x: (pageWidth - scaledWidth) / 2,
          y: (pageHeight - scaledHeight) / 2,
          width: scaledWidth,
          height: scaledHeight,
        });
      } else if (file.type === 'text/plain') {
        // Handle text files
        const text = await extractTextFromTxt(file);
        const page = pdfDoc.addPage(PageSizes.A4);
        const { width, height } = page.getSize();
        
        page.drawText(text, {
          x: 50,
          y: height - 100,
          size: 12,
          color: rgb(0, 0, 0),
          maxWidth: width - 100,
          lineHeight: 16,
        });
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Handle DOCX files
        const text = await extractTextFromDocx(file);
        const page = pdfDoc.addPage(PageSizes.A4);
        const { width, height } = page.getSize();
        
        page.drawText(text, {
          x: 50,
          y: height - 100,
          size: 12,
          color: rgb(0, 0, 0),
          maxWidth: width - 100,
          lineHeight: 16,
        });
      } else if (file.type === 'application/pdf') {
        // Handle existing PDF files
        const existingPdfBytes = await file.arrayBuffer();
        const existingPdf = await PDFDocument.load(existingPdfBytes);
        const copiedPages = await pdfDoc.copyPages(existingPdf, existingPdf.getPageIndices());
        copiedPages.forEach((page) => pdfDoc.addPage(page));
      }
    }

    return await pdfDoc.save();
  };

  const generatePreview = async () => {
    if (files.length === 0) return;
    
    setLoading(true);
    try {
      const pdfBytes = await createPdfFromFiles();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      toast.success('Preview generated!');
    } catch (error) {
      console.error('Error generating preview:', error);
      toast.error('Failed to generate preview');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (files.length === 0) {
      toast.error('Please add files first');
      return;
    }

    setLoading(true);
    try {
      const pdfBytes = await createPdfFromFiles();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `converted-${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded successfully!');
    } catch (error) {
      console.error('Error creating PDF:', error);
      toast.error('Failed to create PDF');
    } finally {
      setLoading(false);
    }
  };

  const getFileIcon = (file: File) => {
    if (SUPPORTED_TYPES.images.includes(file.type)) return '🖼️';
    if (file.type === 'text/plain') return '📝';
    if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '📄';
    if (file.type === 'application/pdf') return '📕';
    return '📄';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Show instructions when no files
  if (files.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📄</div>
          <h3 className="text-lg font-medium text-graphite font-heading mb-2">To PDF Converter</h3>
          <p className="text-mist font-body mb-6">Upload files to convert them into a single PDF</p>
          
          {/* Upload Area */}
          <div className="max-w-2xl mx-auto">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragActive
                  ? 'border-ink bg-ink bg-opacity-5 ring-2 ring-matcha ring-offset-2 scale-105'
                  : 'border-creamline hover:border-matcha hover:bg-matcha hover:bg-opacity-10'
              }`}
            >
              <input {...getInputProps()} />
              <div className="text-4xl mb-4">📁</div>
              {isDragActive ? (
                <p className="text-ink font-medium font-heading">Drop files here...</p>
              ) : (
                <div>
                  <p className="text-graphite font-medium font-heading mb-2">
                    Drag & drop files here, or click to browse
                  </p>
                  <p className="text-sm text-mist font-body">
                    Supports: JPG, PNG, GIF, WebP, TXT, DOCX, PDF
                  </p>
                </div>
              )}
            </div>
            <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
              <span className="mr-1">🔒</span>
              All processing happens locally in your browser. Your files never leave your device.
            </div>
          </div>

          {/* Features */}
          <div className="mt-8 bg-matcha bg-opacity-20 rounded-xl p-6 text-left max-w-md mx-auto">
            <h4 className="text-sm font-medium text-graphite font-heading mb-3 flex items-center">
              <span className="mr-2">✨</span>
              Supported Formats
            </h4>
            <ul className="text-sm text-mist font-body space-y-1">
              <li>• <strong>Images:</strong> JPG, PNG, GIF, WebP</li>
              <li>• <strong>Documents:</strong> TXT, DOCX</li>
              <li>• <strong>PDFs:</strong> Merge existing PDFs</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-xl">📁</span>
          Upload Files
        </h3>
        
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${
            isDragActive
              ? 'border-ink bg-ink bg-opacity-5 ring-2 ring-matcha ring-offset-2'
              : 'border-creamline hover:border-matcha hover:bg-matcha hover:bg-opacity-10'
          }`}
        >
          <input {...getInputProps()} />
          <div className="text-3xl mb-3">📎</div>
          {isDragActive ? (
            <p className="text-ink font-medium font-body">Drop files here...</p>
          ) : (
            <div>
              <p className="text-graphite font-medium font-body mb-1">
                Add more files
              </p>
              <p className="text-xs text-mist font-body">
                Images, documents, or PDFs
              </p>
            </div>
          )}
        </div>
        <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
          <span className="mr-1">🔒</span>
          All processing happens locally in your browser. Your files never leave your device.
        </div>
      </div>

      {/* File List */}
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-graphite font-heading flex items-center">
            <span className="mr-2 text-xl">📋</span>
            Files ({files.length})
          </h3>
          <span className="text-sm text-mist font-body">
            Drag to reorder
          </span>
        </div>
        
        <div className="space-y-3">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between p-4 bg-matcha bg-opacity-10 rounded-xl border border-creamline hover:bg-opacity-20 transition-all duration-200"
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl">{getFileIcon(file)}</span>
                <div>
                  <p className="text-sm font-medium text-graphite font-heading">
                    {file.name}
                  </p>
                  <p className="text-xs text-mist font-body">
                    {formatFileSize(file.size)}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {index > 0 && (
                  <button
                    onClick={() => moveFile(index, index - 1)}
                    className="p-2 text-mist hover:text-graphite hover:scale-110 transition-all duration-200 rounded-lg hover:bg-matcha hover:bg-opacity-20"
                    title="Move up"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                )}
                {index < files.length - 1 && (
                  <button
                    onClick={() => moveFile(index, index + 1)}
                    className="p-2 text-mist hover:text-graphite hover:scale-110 transition-all duration-200 rounded-lg hover:bg-matcha hover:bg-opacity-20"
                    title="Move down"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => removeFile(index)}
                  className="p-2 text-mist hover:text-rose hover:scale-110 transition-all duration-200 rounded-lg hover:bg-rose hover:bg-opacity-20"
                  title="Remove file"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={generatePreview}
            disabled={loading}
            className="bg-matcha text-graphite py-3 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? (
              <>
                <div className="animate-spin w-5 h-5 border-2 border-graphite border-t-transparent rounded-full mr-2"></div>
                Generating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Generate Preview
              </>
            )}
          </button>
          <button
            onClick={downloadPdf}
            disabled={loading}
            className="bg-ink text-white py-3 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? (
              <>
                <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
          <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
            <span className="mr-2 text-xl">👁️</span>
            PDF Preview
          </h3>
          <div className="bg-matcha bg-opacity-10 rounded-xl p-4">
            <iframe
              src={previewUrl}
              className="w-full h-96 border border-creamline rounded-lg shadow-sm transition-all duration-200 hover:shadow-md"
              title="PDF Preview"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ToPdf; 