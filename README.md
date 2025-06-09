# 🛠️ Image Tools

A lightweight, client-side web application built with React + TypeScript for processing images locally in your browser. No uploads to servers - all processing happens on your device!

## ✨ Features

### 📐 Image Resizer
- **Preset Aspect Ratios**: 1:1, 4:5, 16:9, 3:2
- **Custom Dimensions**: Set specific width and height
- **Maintain Aspect Ratio**: Option to preserve original proportions
- **Live Preview**: See changes in real-time
- **Download**: Get your resized image instantly

### 🔁 Format Converter
- **Multiple Formats**: Convert between PNG, JPEG, and SVG
- **Quality Control**: Adjust JPEG compression quality
- **SVG Support**: Convert SVG files to raster formats
- **Live Preview**: Preview converted images before download

### 📥 Upload System
- **Drag & Drop**: Simply drag images into the upload zone
- **Click to Browse**: Traditional file picker
- **Clipboard Paste**: Paste images directly with Ctrl+V (or Cmd+V)
- **File Validation**: Supports PNG, JPG, and SVG files up to 50MB
- **Image Preview**: Thumbnail preview of uploaded images

## 🚀 Getting Started

### Prerequisites
- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd image-tools
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to `http://localhost:3000`

## 🏗️ Project Structure

```
src/
├── components/
│   ├── Tabs.tsx              # Navigation tabs component
│   ├── DropUpload.tsx        # File upload with drag & drop
│   ├── ImageResizer.tsx      # Image resizing tool
│   └── FormatConverter.tsx   # Format conversion tool
├── utils/
│   ├── canvasUtils.ts        # Canvas operations and image processing
│   └── imageHelpers.ts       # Image validation and utility functions
├── App.tsx                   # Main application component
└── index.tsx                 # Application entry point
```

## 🛡️ Privacy & Security

- **100% Client-Side**: All image processing happens in your browser
- **No Server Uploads**: Images never leave your device
- **No Data Collection**: We don't store or track any user data
- **Local Processing**: Uses HTML5 Canvas API for image manipulation

## 🎨 Technologies Used

- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **react-dropzone** for file uploads
- **react-hot-toast** for notifications
- **HTML5 Canvas API** for image processing

## 📱 Browser Support

Works in all modern browsers that support:
- HTML5 Canvas API
- File API
- Drag and Drop API
- Clipboard API (for paste functionality)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with Create React App
- Icons from Unicode emoji set
- Inspired by the need for privacy-focused image tools
