import React, { lazy, Suspense, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import ImageCompressor from './components/ImageCompressor';
import VideoCompressor from './components/VideoCompressor';
import ToolIcon from './components/ToolIcon';
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
    label: 'Compress video',
    icon: 'video',
    category: '',
    title: 'Less size. More play.',
    description:
      'Compress large videos for easier sharing, right from your browser.',
    badge: 'Big videos, easier to share',
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
    id: 'convert',
    label: 'Convert image',
    icon: 'convert',
    category: '',
    title: 'A fresh format.',
    description: 'Turn your image into the format your next project needs.',
    badge: 'Switch it up',
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
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
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
          onClick={() => setActive('image')}
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
                onClick={() => setActive(item.id)}
              >
                <ToolIcon name={item.icon} size={19} />
                <span>{item.label}</span>
                {item.id === 'video' && <span className="new-badge">NEW</span>}
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
              Images stay on your device. Uploaded videos are automatically
              deleted.
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
          {(active === 'image' || active === 'video') && (
            <ol className="workflow-steps" aria-label="How it works">
              <li>
                <span>01</span>Choose a file
              </li>
              <li className="step-line" aria-hidden="true" />
              <li>
                <span>02</span>Find your balance
              </li>
              <li className="step-line" aria-hidden="true" />
              <li>
                <span>03</span>Download & go
              </li>
            </ol>
          )}
          <div hidden={active !== 'image'}>
            <ImageCompressor />
          </div>
          <div hidden={active !== 'video'}>
            <VideoCompressor />
          </div>
          <Suspense
            fallback={
              <p className="status-note" role="status">
                Loading your tool…
              </p>
            }
          >
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
