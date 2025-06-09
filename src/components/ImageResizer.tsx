import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { loadImageFromFile, resizeImage, downloadImage } from '../utils/canvasUtils';
import { ASPECT_RATIOS, AspectRatioKey, calculateDimensionsFromAspectRatio, generateFileName } from '../utils/imageHelpers';
import DropUpload from './DropUpload';

type ResizeMode = 'preset' | 'custom';

const ImageResizer: React.FC = () => {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatioKey>('1:1');
  const [customWidth, setCustomWidth] = useState<string>('');
  const [customHeight, setCustomHeight] = useState<string>('');
  const [useCustomDimensions, setUseCustomDimensions] = useState(false);
  const [maintainAspectRatio, setMaintainAspectRatio] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const resizeModes = [
    {
      id: 'preset' as ResizeMode,
      label: 'Preset Ratios',
      description: 'Popular social media and standard aspect ratios',
      icon: '📐'
    },
    {
      id: 'custom' as ResizeMode,
      label: 'Custom Size',
      description: 'Set exact width and height dimensions',
      icon: '🎯'
    }
  ];

  const handleFileUpload = (file: File | null) => {
    setUploadedFile(file);
  };

  // Load original image when file changes
  useEffect(() => {
    if (uploadedFile) {
      setLoading(true);
      loadImageFromFile(uploadedFile)
        .then((img) => {
          setOriginalImage(img);
          setCustomWidth(img.width.toString());
          setCustomHeight(img.height.toString());
          setLoading(false);
        })
        .catch((error) => {
          console.error('Error loading image:', error);
          toast.error('Failed to load image');
          setLoading(false);
        });
    } else {
      setOriginalImage(null);
      setPreviewCanvas(null);
    }
  }, [uploadedFile]);

  // Update preview when settings change
  useEffect(() => {
    if (originalImage) {
      updatePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImage, selectedAspectRatio, customWidth, customHeight, useCustomDimensions, maintainAspectRatio]);

  const updatePreview = () => {
    if (!originalImage) return;

    try {
      let width: number, height: number;

      if (useCustomDimensions) {
        width = parseInt(customWidth) || originalImage.width;
        height = parseInt(customHeight) || originalImage.height;
      } else {
        const dimensions = calculateDimensionsFromAspectRatio(
          originalImage.width,
          originalImage.height,
          selectedAspectRatio,
          Math.min(originalImage.width, 1920)
        );
        width = dimensions.width;
        height = dimensions.height;
      }

      const canvas = resizeImage(originalImage, {
        width,
        height,
        maintainAspectRatio: useCustomDimensions ? maintainAspectRatio : false
      });

      setPreviewCanvas(canvas);

      // Update canvas display
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          const displayWidth = Math.min(canvas.width, 400);
          const displayHeight = (canvas.height / canvas.width) * displayWidth;
          
          canvasRef.current.width = displayWidth;
          canvasRef.current.height = displayHeight;
          
          ctx.drawImage(canvas, 0, 0, displayWidth, displayHeight);
        }
      }
    } catch (error) {
      console.error('Error updating preview:', error);
      toast.error('Failed to update preview');
    }
  };

  const handleDownload = () => {
    if (!previewCanvas || !uploadedFile) return;
    setLoading(true);

    try {
      const filename = generateFileName(uploadedFile.name, 'resized');
      downloadImage(previewCanvas, filename, 'png');
      toast.success('Image downloaded successfully!');
    } catch (error) {
      console.error('Error downloading image:', error);
      toast.error('Failed to download image');
    } finally {
      setLoading(false);
    }
  };

  const getDimensions = () => {
    if (!originalImage) return { width: 0, height: 0 };
    
    if (useCustomDimensions) {
      return {
        width: parseInt(customWidth) || originalImage.width,
        height: parseInt(customHeight) || originalImage.height
      };
    } else {
      return calculateDimensionsFromAspectRatio(
        originalImage.width,
        originalImage.height,
        selectedAspectRatio,
        Math.min(originalImage.width, 1920)
      );
    }
  };

  if (!uploadedFile) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="text-center py-8 sm:py-12">
          <div className="text-4xl sm:text-6xl mb-4">📐</div>
          <h3 className="text-base sm:text-lg font-medium text-graphite font-heading mb-2">Image Resizer</h3>
          <p className="text-sm sm:text-base text-mist font-body mb-6 px-4">Upload an image to resize it to different dimensions</p>
          
          {/* Upload Area */}
          <div className="max-w-2xl mx-auto px-4">
            <div className="bg-taupe rounded-xl border border-creamline p-4 sm:p-6 shadow-md">
              <h2 className="text-base sm:text-lg font-medium text-graphite font-heading mb-4">Upload Image</h2>
              <DropUpload onFileUpload={handleFileUpload} uploadedFile={uploadedFile} />
              <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
                <span className="mr-1">🔒</span>
                All processing happens locally in your browser. Your files never leave your device.
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="mt-6 sm:mt-8 bg-matcha bg-opacity-20 rounded-xl p-4 sm:p-6 text-left max-w-md mx-auto">
            <h4 className="text-sm font-medium text-graphite font-heading mb-3 flex items-center">
              <span className="mr-2">✨</span>
              Resize Features
            </h4>
            <ul className="text-xs sm:text-sm text-mist font-body space-y-1">
              <li>• <strong>Preset Ratios:</strong> Social media & standard sizes</li>
              <li>• <strong>Custom Dimensions:</strong> Set exact pixel sizes</li>
              <li>• <strong>Aspect Ratio:</strong> Maintain proportions</li>
              <li>• <strong>Live Preview:</strong> See changes instantly</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const dimensions = getDimensions();

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Upload Area */}
      <div className="bg-taupe rounded-xl border border-creamline p-4 sm:p-6 shadow-md">
        <h3 className="text-base sm:text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-lg sm:text-xl">📁</span>
          Upload Image
        </h3>
        <DropUpload onFileUpload={handleFileUpload} uploadedFile={uploadedFile} />
        <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
          <span className="mr-1">🔒</span>
          All processing happens locally in your browser. Your files never leave your device.
        </div>
      </div>

      {/* Resize Mode Selection */}
      <div className="bg-taupe rounded-xl border border-creamline p-4 sm:p-6 shadow-md">
        <h2 className="text-lg sm:text-xl font-semibold text-graphite font-heading mb-4">Resize Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {resizeModes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => {
                setUseCustomDimensions(mode.id === 'custom');
              }}
              className={`p-4 text-left border rounded-xl transition-all duration-200 hover:scale-105 ${
                (mode.id === 'custom') === useCustomDimensions
                  ? 'bg-ink text-white border-ink shadow-md'
                  : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20 hover:border-matcha'
              }`}
            >
              <div className="flex items-start space-x-3">
                <span className="text-2xl">{mode.icon}</span>
                <div>
                  <div className="font-medium font-heading">{mode.label}</div>
                  <div className={`text-sm mt-1 font-body ${(mode.id === 'custom') === useCustomDimensions ? 'text-white opacity-80' : 'text-mist'}`}>
                    {mode.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Settings Panel */}
      <div className="bg-taupe rounded-xl border border-creamline p-4 sm:p-6 shadow-md">
        <h3 className="text-base sm:text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-lg sm:text-xl">{useCustomDimensions ? '🎯' : '📐'}</span>
          <span className="hidden xs:inline">{useCustomDimensions ? 'Custom Dimensions' : 'Preset Aspect Ratios'}</span>
          <span className="xs:hidden">{useCustomDimensions ? 'Custom' : 'Presets'}</span>
        </h3>

        {/* Preset Aspect Ratios */}
        {!useCustomDimensions && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-graphite font-body mb-2">
              Select Aspect Ratio
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(ASPECT_RATIOS).map(([ratio, config]) => (
                <button
                  key={ratio}
                  onClick={() => setSelectedAspectRatio(ratio as AspectRatioKey)}
                  className={`px-4 py-3 text-left rounded-xl border transition-all duration-200 hover:scale-105 ${
                    selectedAspectRatio === ratio
                      ? 'bg-ink text-white border-ink shadow-md'
                      : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20 hover:border-matcha'
                  }`}
                >
                  <div className="font-medium font-heading">{ratio}</div>
                  <div className={`text-xs mt-1 font-body ${selectedAspectRatio === ratio ? 'text-white opacity-80' : 'text-mist'}`}>{config.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom Dimensions */}
        {useCustomDimensions && (
          <div className="mb-6">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-graphite font-body mb-1">
                  Width (px)
                </label>
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  className="w-full px-3 py-2 border border-creamline rounded-xl focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink bg-milk text-graphite transition-all font-body"
                  placeholder="Width"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-graphite font-body mb-1">
                  Height (px)
                </label>
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  className="w-full px-3 py-2 border border-creamline rounded-xl focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink bg-milk text-graphite transition-all font-body"
                  placeholder="Height"
                  min="1"
                />
              </div>
            </div>
            
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={maintainAspectRatio}
                onChange={(e) => setMaintainAspectRatio(e.target.checked)}
                className="mr-2 accent-ink"
              />
              <span className="text-sm text-graphite font-body">Maintain aspect ratio</span>
            </label>
          </div>
        )}

        {/* Output Dimensions */}
        {originalImage && (
          <div className="bg-matcha bg-opacity-20 rounded-xl p-4 mb-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-graphite font-body">Original:</span>
                <span className="text-mist ml-2 font-body">
                  {originalImage.width} × {originalImage.height}
                </span>
              </div>
              <div>
                <span className="font-medium text-graphite font-body">Output:</span>
                <span className="text-mist ml-2 font-body">
                  {dimensions.width} × {dimensions.height}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Download Button */}
        <button
          onClick={handleDownload}
          disabled={!previewCanvas || loading}
          className="w-full bg-ink text-white py-3 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
        >
          {loading ? (
            <>
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
              Processing...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Resized Image
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
                <span className="ml-2 text-mist font-body">Processing...</span>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className="max-w-full h-auto border border-creamline rounded-lg shadow-sm transition-all duration-200 hover:shadow-md"
                style={{ maxHeight: '400px' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageResizer; 