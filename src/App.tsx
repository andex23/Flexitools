import React, { lazy, Suspense, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import ImageCompressor from './components/ImageCompressor';
import ToolIcon from './components/ToolIcon';
const BrowserMediaTools = lazy(() => import('./components/BrowserMediaTools'));
const BatchImageCompressor = lazy(() => import('./components/BatchImageCompressor'));
const ImageEditor = lazy(() => import('./components/ImageEditor'));
const HeicConverter = lazy(() => import('./components/HeicConverter'));
const PdfWorkbench = lazy(() => import('./components/PdfWorkbench'));
const ImageResizer = lazy(() => import('./components/ImageResizer'));
const FormatConverter = lazy(() => import('./components/FormatConverter'));
const ToPdf = lazy(() => import('./components/ToPdf'));
const CSVConverter = lazy(() => import('./components/CSVConverter'));

const tools = [
  {
    id: 'image',
    label: 'Compress image',
    icon: 'image',
    category: 'MEDIA TOOLS',
    title: 'Small file. Big impression.',
    description: 'Lighter images, without leaving the details behind.',
    badge: 'Images, made lighter',
  },
  {
    id: 'video',
    label: 'Video & audio',
    icon: 'video',
    category: '',
    title: 'Less size. More play.',
    description:
      'Compress, trim, mute, or extract audio. Your files stay on your device.',
    badge: 'Your media, made useful',
  },
  {
    id: 'batch', label: 'Batch images', icon: 'batch', category: 'IMAGE TOOLS',
    title: 'A lighter batch.',
    description: 'Compress a collection of images and download them together.',
    badge: 'One batch. Less busywork.',
  },
  {
    id: 'resize',
    label: 'Resize image',
    icon: 'resize',
    category: '',
    title: 'The right size for every space.',
    description: 'Set your dimensions, keep your proportions, and make it fit.',
    badge: 'Every pixel, in place',
  },
  {
    id: 'edit', label: 'Edit image', icon: 'crop', category: '',
    title: 'Make it your own.',
    description: 'Crop, rotate, add a watermark, or remove embedded metadata.',
    badge: 'A few finishing touches',
  },
  {
    id: 'convert',
    label: 'Convert image',
    icon: 'convert',
    category: '',
    title: 'A fresh format.',
    description: 'Turn your image into the format your next project needs.',
    badge: 'Switch it up',
  },
  {
    id: 'heic', label: 'Convert HEIC', icon: 'image', category: '',
    title: 'From phone to everywhere.',
    description: 'Turn a HEIC photo into a JPG, PNG, or WebP you can share.',
    badge: 'More ways to share',
  },
  {
    id: 'topdf',
    label: 'Create PDF',
    icon: 'pdf',
    category: 'FILE TOOLS',
    title: 'Bring it all together.',
    description: 'Turn your images and documents into a shareable PDF.',
    badge: 'From files to finished',
  },
  {
    id: 'organizepdf', label: 'Organize PDFs', icon: 'pdf', category: '',
    title: 'Every page in its place.',
    description: 'Merge PDFs, choose and reorder pages, or split them into a ZIP.',
    badge: 'Put your pages to work',
  },
  {
    id: 'csvconverter',
    label: 'Convert CSV',
    icon: 'table',
    category: '',
    title: 'Your data. A different format.',
    description: 'Convert between CSV, JSON, Excel, and PDF.',
    badge: 'Make your data move',
  },
];

export default function App() {
  const [active, setActive] = useState('image');
  const [visited, setVisited] = useState<string[]>(['image']);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const selectTool = (id: string) => {
    setActive(id);
    setVisited((previous) => previous.includes(id) ? previous : [...previous, id]);
  };
  const tool = tools.find((item) => item.id === active)!;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to tool
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#image"
          onClick={() => selectTool('image')}
          aria-label="Flexitool home"
        >
          <span className="brand-symbol">
            f<span>.</span>
          </span>
          <span>
            flexitool<span className="brand-period">.</span>
          </span>
        </a>
        <div className="sidebar-intro">
          A little less file.
          <br />A lot more possibility.
        </div>
        <nav className="tool-navigation" aria-label="Tools">
          {tools.map((item) => (
            <React.Fragment key={item.id}>
              {item.category && <p className="nav-category">{item.category}</p>}
              <button
                className={`nav-item ${active === item.id ? 'active' : ''}`}
                aria-current={active === item.id ? 'page' : undefined}
                onClick={() => selectTool(item.id)}
              >
                <ToolIcon name={item.icon} size={19} />
                <span>{item.label}</span>
                {item.id === 'video' && <span className="new-badge">FREE</span>}
                {active === item.id && <span className="nav-dot" />}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ToolIcon name="shield" size={24} />
            <h3>Your files, handled with care.</h3>
            <p>
              Free tools. Your files stay on your device.
            </p>
          </div>
          <a
            href="https://github.com/andex23/Flexitools"
            target="_blank"
            rel="noreferrer"
            className="source-link"
          >
            Built to be useful.
            <ToolIcon name="arrow" size={15} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>YOUR EVERYDAY TOOLBOX</span>
          <a
            href="https://github.com/andex23/Flexitools"
            target="_blank"
            rel="noreferrer"
          >
            Open source
            <ToolIcon name="arrow" size={15} />
          </a>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div className="eyebrow">
              <span />
              {tool.badge}
            </div>
            <h1>{tool.title}</h1>
            <p>{tool.description}</p>
          </div>
          <div className="tool-workflow">
            <ol className="workflow-steps" aria-label="How it works">
              <li>
                <span>01</span>Choose files
              </li>
              <li className="step-line" aria-hidden="true" />
              <li>
                <span>02</span>Make it yours
              </li>
              <li className="step-line" aria-hidden="true" />
              <li>
                <span>03</span>Download & go
              </li>
            </ol>
          </div>
          <div hidden={active !== 'image'}>
            <ImageCompressor />
          </div>
          <Suspense
            fallback={
              <p className="status-note" role="status">
                Loading your tool…
              </p>
            }
          >
            {visited.includes('video') && <div hidden={active !== 'video'}><BrowserMediaTools /></div>}
            {visited.includes('batch') && <div hidden={active !== 'batch'}><BatchImageCompressor /></div>}
            {visited.includes('edit') && <div hidden={active !== 'edit'}><ImageEditor /></div>}
            {visited.includes('heic') && <div hidden={active !== 'heic'}><HeicConverter /></div>}
            {visited.includes('organizepdf') && <div hidden={active !== 'organizepdf'}><PdfWorkbench /></div>}
            <div className="legacy-tool">
              {active === 'resize' && <ImageResizer />}
              {active === 'convert' && <FormatConverter />}
              {active === 'topdf' && (
                <ToPdf files={pdfFiles} onFilesChange={setPdfFiles} />
              )}{' '}
              {active === 'csvconverter' && <CSVConverter />}
            </div>
          </Suspense>
          <footer className="workspace-footer">
            <span>Less friction. More making.</span>
            <span>
              Made by Sch1xo <span className="footer-dot">·</span> Flexitool
            </span>
          </footer>
        </main>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: '#203e33', color: '#fff', fontSize: '14px' },
        }}
      />
    </div>
  );
}
