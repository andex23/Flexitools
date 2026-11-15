import React, { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { loadImageFromFile, downloadImage } from '../utils/canvasUtils';
import { generateFileName, formatFileSize } from '../utils/imageHelpers';
import DropUpload from './DropUpload';

type OutputFormat = 'jpg' | 'png' | 'svg' | 'webp';
type ConversionTool = 'format' | 'quality';

const FormatConverter: React.FC = () => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('png');
  const [jpegQuality, setJpegQuality] = useState(90);
  const [selectedTool, setSelectedTool] = useState<ConversionTool>('format');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const conversionTools = [
    {
      id: 'format' as ConversionTool,
      label: 'Format Conversion',
      description: 'Convert between JPG, PNG, SVG, and WebP',
      icon: '🔄'
    },
    {
      id: 'quality' as ConversionTool,
      label: 'Quality Settings',
      description: 'Adjust compression and quality settings',
      icon: '⚙️'
    }
  ];

  const formats = [
    { value: 'jpg' as OutputFormat, label: 'JPG', description: 'Best for photos' },
    { value: 'png' as OutputFormat, label: 'PNG', description: 'Best for graphics' },
    { value: 'webp' as OutputFormat, label: 'WebP', description: 'Modern format' },
    { value: 'svg' as OutputFormat, label: 'SVG', description: 'Embedded image; not vector tracing' }
  ];

  const handleFileUpload = useCallback((file: File | null) => {
    setUploadedFile(file);
    setOriginalImage(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setOriginalImage(null);
    if (!uploadedFile) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadImageFromFile(uploadedFile).then((img) => {
      if (cancelled) return;
      setOriginalImage(img);
      setLoading(false);
    }).catch((error) => {
      if (cancelled) return;
      toast.error(error instanceof Error ? error.message : 'Failed to load image');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [uploadedFile]);

  useEffect(() => {
    if (!originalImage || !canvasRef.current || loading) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(400 / originalImage.width, 400 / originalImage.height, 1);
    canvas.width = Math.max(1, Math.round(originalImage.width * scale));
    canvas.height = Math.max(1, Math.round(originalImage.height * scale));
    if (outputFormat === 'jpg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
  }, [originalImage, outputFormat, loading]);

  const handleDownload = async () => {
    if (!originalImage || !uploadedFile) return;
    setLoading(true);
    let exportCanvas: HTMLCanvasElement | null = null;

    try {
      // Create a new canvas with original dimensions for export
      exportCanvas = document.createElement('canvas');
      const exportCtx = exportCanvas.getContext('2d');
      if (!exportCtx) throw new Error('Could not get canvas context');

      exportCanvas.width = originalImage.width;
      exportCanvas.height = originalImage.height;
      if (outputFormat === 'jpg') {
        exportCtx.fillStyle = '#fff';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      }
      exportCtx.drawImage(originalImage, 0, 0);

      const filename = generateFileName(uploadedFile.name, 'converted', outputFormat);
      
      if (outputFormat === 'svg') {
        // For SVG, we need to handle it differently
        const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${originalImage.width}" height="${originalImage.height}">
          <image href="${exportCanvas.toDataURL()}" width="${originalImage.width}" height="${originalImage.height}"/>
        </svg>`;
        
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const quality = outputFormat === 'jpg' || outputFormat === 'webp' ? jpegQuality / 100 : undefined;
        await downloadImage(exportCanvas, filename, outputFormat, quality);
      }
      
      toast.success('Converted image download started');
    } catch (error) {
      console.error('Error converting image:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to convert image');
    } finally {
      if (exportCanvas) { exportCanvas.width = 0; exportCanvas.height = 0; }
      setLoading(false);
    }
  };

  if (!uploadedFile) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🔁</div>
          <h3 className="text-lg font-medium text-graphite font-heading mb-2">Format Converter</h3>
          <p className="text-mist font-body mb-6">Upload an image to convert between formats</p>
          
          {/* Upload Area */}
          <div className="max-w-2xl mx-auto">
            <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
              <h2 className="text-lg font-medium text-graphite font-heading mb-4">Upload Image</h2>
              <DropUpload onFileUpload={handleFileUpload} uploadedFile={uploadedFile} />
              <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
                <span className="mr-1">🔒</span>
                All processing happens locally in your browser. Your files never leave your device.
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="mt-8 bg-matcha bg-opacity-20 rounded-xl p-6 text-left max-w-md mx-auto">
            <h4 className="text-sm font-medium text-graphite font-heading mb-3 flex items-center">
              <span className="mr-2">✨</span>
              Conversion Features
            </h4>
            <ul className="text-sm text-mist font-body space-y-1">
              <li>• <strong>Multiple Formats:</strong> JPG, PNG, WebP, SVG</li>
              <li>• <strong>Quality Control:</strong> Adjust compression settings</li>
              <li>• <strong>Local processing:</strong> Convert one image at a time</li>
              <li>• <strong>Format choices:</strong> PNG preserves pixels; JPG and WebP use lossy compression</li>
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
          Upload Image
        </h3>
        <DropUpload onFileUpload={handleFileUpload} uploadedFile={uploadedFile} />
        <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
          <span className="mr-1">🔒</span>
          All processing happens locally in your browser. Your files never leave your device.
        </div>
      </div>

      {/* Conversion Tool Selection */}
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h2 className="text-xl font-semibold text-graphite font-heading mb-4">Conversion Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {conversionTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setSelectedTool(tool.id)}
              className={`p-4 text-left border rounded-xl transition-all duration-200 hover:scale-105 ${
                selectedTool === tool.id
                  ? 'bg-ink text-white border-ink shadow-md'
                  : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20 hover:border-matcha'
              }`}
            >
              <div className="flex items-start space-x-3">
                <span className="text-2xl">{tool.icon}</span>
                <div>
                  <div className="font-medium font-heading">{tool.label}</div>
                  <div className={`text-sm mt-1 font-body ${selectedTool === tool.id ? 'text-white opacity-80' : 'text-mist'}`}>
                    {tool.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* File Information */}
      {uploadedFile && (
        <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
          <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
            <span className="mr-2 text-xl">📋</span>
            File Information
          </h3>
          <div className="bg-matcha bg-opacity-10 rounded-xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-graphite font-body">Name:</span>
                <div className="text-mist font-body truncate" title={uploadedFile.name}>
                  {uploadedFile.name}
                </div>
              </div>
              <div>
                <span className="font-medium text-graphite font-body">Size:</span>
                <div className="text-mist font-body">
                  {formatFileSize(uploadedFile.size)}
                </div>
              </div>
              {originalImage && (
                <div>
                  <span className="font-medium text-graphite font-body">Dimensions:</span>
                  <div className="text-mist font-body">
                    {originalImage.width} × {originalImage.height}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conversion Settings */}
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-xl">{selectedTool === 'format' ? '🔄' : '⚙️'}</span>
          {selectedTool === 'format' ? 'Format Selection' : 'Quality Settings'}
        </h3>

        {selectedTool === 'format' && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-graphite font-body mb-2">
              Output Format
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {formats.map((format) => (
                <button
                  key={format.value}
                  onClick={() => setOutputFormat(format.value)}
                  className={`p-3 text-center rounded-xl border transition-all duration-200 hover:scale-105 ${
                    outputFormat === format.value
                      ? 'bg-ink text-white border-ink shadow-md'
                      : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20 hover:border-matcha'
                  }`}
                >
                  <div className="font-medium font-heading">{format.label}</div>
                  <div className={`text-xs mt-1 font-body ${outputFormat === format.value ? 'text-white opacity-80' : 'text-mist'}`}>
                    {format.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedTool === 'quality' && (
          <div className="mb-6">
            <div className="mb-4">
              <label htmlFor="converter-output-format" className="block text-sm font-medium text-graphite font-body mb-2">
                Output Format
              </label>
              <select
                id="converter-output-format"
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                className="w-full px-3 py-2 border border-creamline rounded-xl focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink bg-milk text-graphite font-body"
              >
                {formats.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label} - {format.description}
                  </option>
                ))}
              </select>
            </div>

            {(outputFormat === 'jpg' || outputFormat === 'webp') && (
              <div>
                <label htmlFor="converter-quality" className="block text-sm font-medium text-graphite font-body mb-2">
                  Export quality: {jpegQuality}%
                </label>
                <input
                  type="range"
                  id="converter-quality"
                  min="10"
                  max="100"
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(parseInt(e.target.value))}
                  className="w-full accent-ink"
                />
                <div className="flex justify-between text-xs text-mist font-body mt-1">
                  <span>Lower size</span>
                  <span>Higher quality</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Download Button */}
        {outputFormat === 'jpg' && <p className="text-sm text-mist mb-4">JPG uses lossy compression and replaces transparent areas with white.</p>}
        <button
          onClick={handleDownload}
          disabled={!originalImage || loading}
          className="w-full bg-ink text-white py-3 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
        >
          {loading ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
              Converting...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Convert & Download
            </>
          )}
        </button>
      </div>

      {/* Preview */}
      {originalImage && (
        <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
          <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
            <span className="mr-2 text-xl">👁️</span>
            Preview
          </h3>
          <div className="bg-matcha bg-opacity-10 rounded-xl p-4 flex justify-center">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ink"></div>
                <span className="ml-2 text-mist font-body">Loading...</span>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className="max-w-full h-auto border border-creamline rounded-lg shadow-sm transition-all duration-200 hover:shadow-md"
                style={{ maxHeight: '400px' }}
              />
            )}
          </div>
          <div className="mt-4 text-center">
            <span className="text-sm text-mist font-body">
              Output: {outputFormat.toUpperCase()}
              {(outputFormat === 'jpg' || outputFormat === 'webp') && ` (${jpegQuality}% quality)`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default FormatConverter;
