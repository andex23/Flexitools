import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import Tabs, { Tab } from './components/Tabs';
import ImageResizer from './components/ImageResizer';
import FormatConverter from './components/FormatConverter';
import ToPdf from './components/ToPdf';
import CSVConverter from './components/CSVConverter';
import TimeDisplay from './components/TimeDisplay';

const tabs: Tab[] = [
  {
    id: 'resize',
    label: 'Image Resizer',
    icon: '📐'
  },
  {
    id: 'convert',
    label: 'Format Converter',
    icon: '🔁'
  },
  {
    id: 'topdf',
    label: 'To PDF',
    icon: '📄'
  },
  {
    id: 'csvconverter',
    label: 'CSV Converter',
    icon: '📊'
  }
];

function App() {
  const [activeTab, setActiveTab] = useState('resize');
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);

  const handlePdfFilesChange = (files: File[]) => {
    setPdfFiles(files);
  };

  const renderActiveToolContent = () => {
    switch (activeTab) {
      case 'resize':
        return <ImageResizer />;
      case 'convert':
        return <FormatConverter />;
      case 'topdf':
        return <ToPdf files={pdfFiles} onFilesChange={handlePdfFilesChange} />;
      case 'csvconverter':
        return <CSVConverter />;
      default:
        return <ImageResizer />;
    }
  };

  return (
    <div className="min-h-screen bg-milk font-body flex flex-col">
      {/* Header */}
      <header className="bg-taupe shadow-sm border-b border-creamline">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div 
              className="flex items-center space-x-2 sm:space-x-3 cursor-pointer hover:opacity-80 transition-opacity duration-200"
              onClick={() => window.location.reload()}
            >
              <img 
                src="/flexitool-logo.svg" 
                alt="FlexiTool Logo" 
                className="h-6 w-6 sm:h-8 sm:w-8"
              />
              <div>
                <h1 className="text-xs sm:text-sm font-semibold text-graphite font-heading">Flexitool</h1>
                <p className="text-xs text-mist">Resize and convert images and files</p>
              </div>
            </div>
            <TimeDisplay />
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8 w-full">
        {/* All tools now use full width and handle their own uploads */}
        <div>
          {renderActiveToolContent()}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-mist text-xs sm:text-sm py-4 sm:py-6 mt-auto border-t border-creamline bg-taupe">
        <div className="block sm:hidden">Made by Sch1xo</div>
        <div className="block sm:hidden">© Acestar Villam Domum</div>
        <div className="hidden sm:block">Made by Sch1xo • © Acestar Villam Domum</div>
      </footer>

      {/* Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#363636',
            color: '#fff',
            fontSize: '14px',
          },
          success: {
            duration: 2000,
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </div>
  );
}

export default App;
