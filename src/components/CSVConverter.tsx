import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import toast from 'react-hot-toast';

type CSVTool = 'upload' | 'text' | 'json';
type Delimiter = 'comma' | 'tab' | 'semicolon';

interface CSVData {
  headers: string[];
  rows: string[][];
}

const CSVConverter: React.FC = () => {
  const [activeTool, setActiveTool] = useState<CSVTool>('upload');
  const [csvData, setCsvData] = useState<CSVData | null>(null);
  const [textInput, setTextInput] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>('comma');
  const [filename, setFilename] = useState('converted_data');
  const [loading, setLoading] = useState(false);

  const tools = [
    { 
      id: 'upload' as CSVTool, 
      label: 'Upload CSV/TXT', 
      description: 'Upload and convert CSV or TXT files',
      icon: '📁'
    },
    { 
      id: 'text' as CSVTool, 
      label: 'Text to CSV', 
      description: 'Convert raw text to CSV format',
      icon: '✍️'
    },
    { 
      id: 'json' as CSVTool, 
      label: 'JSON to CSV', 
      description: 'Convert JSON arrays to CSV',
      icon: '🔁'
    },
  ];

  const getDelimiterChar = (delim: Delimiter): string => {
    switch (delim) {
      case 'comma': return ',';
      case 'tab': return '\t';
      case 'semicolon': return ';';
      default: return ',';
    }
  };

  const detectDelimiter = (text: string): string => {
    const sample = text.split('\n').slice(0, 5).join('\n'); // Use first 5 lines
    const delimiters = [',', '\t', ';', '|'];
    let maxCount = 0;
    let bestDelimiter = ',';

    delimiters.forEach(delim => {
      const count = (sample.match(new RegExp(`\\${delim}`, 'g')) || []).length;
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = delim;
      }
    });

    return bestDelimiter;
  };

  const parseCSVText = (text: string, delim: string = ','): CSVData | null => {
    try {
      const result = Papa.parse(text, {
        delimiter: delim,
        header: false,
        skipEmptyLines: true
      });

      if (result.errors.length > 0) {
        console.warn('CSV parsing warnings:', result.errors);
      }

      const data = result.data as string[][];
      if (data.length === 0) return null;

      const headers = data[0];
      const rows = data.slice(1);

      return { headers, rows };
    } catch (error) {
      console.error('Error parsing CSV:', error);
      return null;
    }
  };

  const parseJSONToCSV = (jsonText: string): CSVData | null => {
    try {
      const jsonData = JSON.parse(jsonText);
      
      if (!Array.isArray(jsonData)) {
        throw new Error('JSON must be an array of objects');
      }

      if (jsonData.length === 0) return null;

      // Get all unique keys from all objects
      const allKeys = new Set<string>();
      jsonData.forEach(obj => {
        if (typeof obj === 'object' && obj !== null) {
          Object.keys(obj).forEach(key => allKeys.add(key));
        }
      });

      const headers = Array.from(allKeys);
      const rows = jsonData.map(obj => {
        return headers.map(header => {
          const value = obj?.[header];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        });
      });

      return { headers, rows };
    } catch (error) {
      console.error('Error parsing JSON:', error);
      toast.error('Invalid JSON format');
      return null;
    }
  };

  // File upload handler
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setLoading(true);
      const file = acceptedFiles[0];
      const isCSV = file.type === 'text/csv' || file.name.endsWith('.csv');
      const isTXT = file.type === 'text/plain' || file.name.endsWith('.txt');
      
      if (!isCSV && !isTXT) {
        toast.error('Please upload a CSV or TXT file');
        setLoading(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        
        // Auto-detect delimiter for TXT files
        let delimiter = ',';
        if (isTXT) {
          delimiter = detectDelimiter(text);
        }
        
        const parsed = parseCSVText(text, delimiter);
        if (parsed) {
          setCsvData(parsed);
          const fileType = isCSV ? 'CSV' : 'TXT';
          toast.success(`${fileType} file uploaded and parsed successfully!`);
          
          // Set filename based on uploaded file
          const baseName = file.name.replace(/\.(csv|txt)$/i, '');
          setFilename(baseName + '_converted');
        } else {
          toast.error('Failed to parse file');
        }
        setLoading(false);
      };
      reader.readAsText(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.txt']
    },
    multiple: false
  });

  // Handle text input changes
  const handleTextInputChange = (value: string) => {
    setTextInput(value);
    if (value.trim()) {
      const parsed = parseCSVText(value, getDelimiterChar(delimiter));
      setCsvData(parsed);
    } else {
      setCsvData(null);
    }
  };

  // Handle JSON input changes
  const handleJsonInputChange = (value: string) => {
    setJsonInput(value);
    if (value.trim()) {
      const parsed = parseJSONToCSV(value);
      setCsvData(parsed);
    } else {
      setCsvData(null);
    }
  };

  // Handle delimiter change
  const handleDelimiterChange = (newDelimiter: Delimiter) => {
    setDelimiter(newDelimiter);
    if (textInput.trim()) {
      const parsed = parseCSVText(textInput, getDelimiterChar(newDelimiter));
      setCsvData(parsed);
    }
  };

  // Download functions
  const downloadCSV = () => {
    if (!csvData) return;
    setLoading(true);

    const csvContent = [
      csvData.headers.join(','),
      ...csvData.rows.map(row => row.map(cell => 
        cell.includes(',') || cell.includes('"') || cell.includes('\n') 
          ? `"${cell.replace(/"/g, '""')}"` 
          : cell
      ).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success('CSV downloaded successfully!');
    setLoading(false);
  };

  const downloadJSON = () => {
    if (!csvData) return;
    setLoading(true);

    const jsonData = csvData.rows.map(row => {
      const obj: Record<string, string> = {};
      csvData.headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success('JSON downloaded successfully!');
    setLoading(false);
  };

  const downloadExcel = () => {
    if (!csvData) return;
    setLoading(true);

    const ws = XLSX.utils.aoa_to_sheet([csvData.headers, ...csvData.rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${filename}.xlsx`);
    
    toast.success('Excel file downloaded successfully!');
    setLoading(false);
  };

  const downloadPDF = () => {
    if (!csvData) return;
    setLoading(true);
    
    try {
      const doc = new jsPDF();
      
      // Add title
      doc.setFontSize(16);
      doc.text('CSV Data Export', 20, 20);
      
      // Add table data
      doc.setFontSize(10);
      let yPosition = 40;
      const pageHeight = doc.internal.pageSize.height;
      
      // Headers
      const headerText = csvData.headers.join(' | ');
      doc.setFont('helvetica', 'bold');
      doc.text(headerText, 20, yPosition);
      yPosition += 10;
      
      // Data rows
      doc.setFont('helvetica', 'normal');
      csvData.rows.forEach(row => {
        if (yPosition > pageHeight - 30) {
          doc.addPage();
          yPosition = 20;
        }
        
        const rowText = row.join(' | ');
        doc.text(rowText, 20, yPosition);
        yPosition += 8;
      });
      
      doc.save(`${filename}.pdf`);
      toast.success('PDF downloaded successfully!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF');
    }
    
    setLoading(false);
  };

  const renderDataTable = () => {
    if (!csvData) return null;

    return (
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-graphite font-heading">Data Preview</h3>
            <p className="text-sm text-mist">
              {csvData.rows.length} rows × {csvData.headers.length} columns (showing first 10 rows)
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <label className="text-sm text-graphite font-body">Filename:</label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="px-3 py-1 border border-creamline rounded-lg text-sm bg-milk text-graphite focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink transition-all font-body"
              />
            </div>
          </div>
        </div>
        
        <div className="overflow-auto border border-creamline rounded-lg mb-4">
          <table className="min-w-full">
            <thead className="bg-matcha bg-opacity-20">
              <tr>
                {csvData.headers.map((header, index) => (
                  <th key={index} className="px-4 py-2 text-left text-sm font-medium text-graphite font-body border-b border-creamline">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csvData.rows.slice(0, 10).map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-milk' : 'bg-taupe'}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-2 text-sm text-graphite font-body border-b border-creamline">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <button
            onClick={downloadJSON}
            disabled={loading}
            className="bg-ink text-white py-2 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div> : null}
            Download JSON
          </button>
          <button
            onClick={downloadExcel}
            disabled={loading}
            className="bg-matcha text-graphite py-2 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? <div className="animate-spin w-4 h-4 border-2 border-graphite border-t-transparent rounded-full mr-2"></div> : null}
            Download Excel
          </button>
          <button
            onClick={downloadPDF}
            disabled={loading}
            className="bg-matcha text-graphite py-2 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? <div className="animate-spin w-4 h-4 border-2 border-graphite border-t-transparent rounded-full mr-2"></div> : null}
            Download PDF
          </button>
          <button
            onClick={downloadCSV}
            disabled={loading}
            className="bg-ink text-white py-2 px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body flex items-center justify-center"
          >
            {loading ? <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div> : null}
            Download CSV
          </button>
        </div>
      </div>
    );
  };

  const renderUploadTool = () => (
    <div className="space-y-6">
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-xl">📁</span>
          Upload CSV/TXT File
        </h3>
        
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
            isDragActive
              ? 'border-ink bg-ink bg-opacity-5 ring-2 ring-matcha ring-offset-2'
              : 'border-creamline hover:border-matcha hover:bg-matcha hover:bg-opacity-10'
          } ${loading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input {...getInputProps()} />
          {loading ? (
            <div className="flex flex-col items-center">
              <div className="animate-spin w-8 h-8 border-4 border-ink border-t-transparent rounded-full mb-4"></div>
              <p className="text-graphite font-body">Processing file...</p>
            </div>
          ) : (
            <>
              <div className="text-4xl mb-4">📊</div>
              <p className="text-graphite font-body mb-2">
                {isDragActive ? 'Drop your file here' : 'Drag and drop a CSV or TXT file here, or click to browse'}
              </p>
              <p className="text-mist text-sm font-body">Supports .csv and .txt files • Auto-detects delimiters for TXT files</p>
            </>
          )}
        </div>
        
        <div className="mt-3 text-xs text-mist text-center flex items-center justify-center">
          <span className="mr-1">🔒</span>
          All processing happens locally in your browser. Your files never leave your device.
        </div>

        {csvData && (
          <div className="mt-6 p-4 bg-matcha bg-opacity-20 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm text-graphite font-body">
                ✅ File processed: {csvData.rows.length} rows × {csvData.headers.length} columns
              </span>
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-graphite font-body">Filename:</label>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="px-3 py-1 border border-creamline rounded-lg text-sm bg-milk text-graphite focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink transition-all font-body"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-4">
              <button
                onClick={downloadJSON}
                disabled={loading}
                className="bg-ink text-white py-2 px-2 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                JSON
              </button>
              <button
                onClick={downloadExcel}
                disabled={loading}
                className="bg-matcha text-graphite py-2 px-2 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                Excel
              </button>
              <button
                onClick={downloadPDF}
                disabled={loading}
                className="bg-matcha text-graphite py-2 px-2 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                PDF
              </button>
              <button
                onClick={downloadCSV}
                disabled={loading}
                className="bg-ink text-white py-2 px-2 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderTextTool = () => (
    <div className="space-y-6">
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-xl">✍️</span>
          Text to CSV
        </h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-graphite font-body mb-2">Delimiter:</label>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {[
              { key: 'comma' as Delimiter, label: 'Comma (,)', short: 'Comma', char: ',' },
              { key: 'tab' as Delimiter, label: 'Tab', short: 'Tab', char: '\\t' },
              { key: 'semicolon' as Delimiter, label: 'Semicolon (;)', short: 'Semi', char: ';' }
            ].map(delim => (
              <button
                key={delim.key}
                onClick={() => handleDelimiterChange(delim.key)}
                className={`px-2 sm:px-3 py-2 text-xs sm:text-sm rounded-xl border transition-all duration-200 hover:scale-105 font-body ${
                  delimiter === delim.key
                    ? 'bg-ink text-white border-ink'
                    : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20'
                }`}
              >
                <span className="hidden xs:inline">{delim.label}</span>
                <span className="xs:hidden">{delim.short}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-graphite font-body mb-2">Enter CSV data:</label>
          <textarea
            value={textInput}
            onChange={(e) => handleTextInputChange(e.target.value)}
            placeholder={`Name${getDelimiterChar(delimiter)}Age${getDelimiterChar(delimiter)}City\nJohn${getDelimiterChar(delimiter)}30${getDelimiterChar(delimiter)}New York\nJane${getDelimiterChar(delimiter)}25${getDelimiterChar(delimiter)}San Francisco`}
            className="w-full h-40 px-3 py-2 border border-creamline rounded-xl bg-milk text-graphite placeholder-mist focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink resize-none font-body text-sm transition-all"
          />
          <div className="mt-2 text-xs text-mist text-center flex items-center justify-center">
            <span className="mr-1">🔒</span>
            All processing happens locally in your browser. No data is sent to servers.
          </div>
        </div>

        {csvData && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-matcha bg-opacity-20 rounded-xl space-y-3 sm:space-y-0">
            <span className="text-xs sm:text-sm text-graphite font-body">
              ✅ {csvData.rows.length} rows × {csvData.headers.length} columns
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
              <div className="flex items-center space-x-2">
                <label className="text-xs sm:text-sm text-graphite font-body">Filename:</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="px-2 sm:px-3 py-1 border border-creamline rounded-lg text-xs sm:text-sm bg-milk text-graphite focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink transition-all font-body"
                />
              </div>
              <button
                onClick={downloadCSV}
                disabled={loading}
                className="bg-ink text-white py-2 px-3 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                Download CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderJsonTool = () => (
    <div className="space-y-6">
      <div className="bg-taupe rounded-xl border border-creamline p-6 shadow-md">
        <h3 className="text-lg font-medium text-graphite font-heading mb-4 flex items-center">
          <span className="mr-2 text-xl">🔁</span>
          JSON to CSV
        </h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-graphite font-body mb-2">Enter JSON data:</label>
          <textarea
            value={jsonInput}
            onChange={(e) => handleJsonInputChange(e.target.value)}
            placeholder='[{"name": "John", "age": 30, "city": "New York"}, {"name": "Jane", "age": 25, "city": "San Francisco"}]'
            className="w-full h-40 px-3 py-2 border border-creamline rounded-xl bg-milk text-graphite placeholder-mist focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink resize-none font-body text-sm transition-all"
          />
          <div className="mt-2 text-xs text-mist text-center flex items-center justify-center">
            <span className="mr-1">🔒</span>
            All processing happens locally in your browser. No data is sent to servers.
          </div>
        </div>

        {csvData && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-matcha bg-opacity-20 rounded-xl space-y-3 sm:space-y-0">
            <span className="text-xs sm:text-sm text-graphite font-body">
              ✅ {csvData.rows.length} rows × {csvData.headers.length} columns
            </span>
            <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
              <div className="flex items-center space-x-2">
                <label className="text-xs sm:text-sm text-graphite font-body">Filename:</label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="px-2 sm:px-3 py-1 border border-creamline rounded-lg text-xs sm:text-sm bg-milk text-graphite focus:outline-none focus:ring-2 focus:ring-ink focus:border-ink transition-all font-body"
                />
              </div>
              <button
                onClick={downloadCSV}
                disabled={loading}
                className="bg-ink text-white py-2 px-3 sm:px-4 rounded-xl hover:bg-opacity-80 hover:scale-105 disabled:opacity-50 disabled:cursor-wait transition-all duration-200 font-medium font-body text-xs sm:text-sm"
              >
                Download CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Tool Selection */}
      <div className="bg-taupe rounded-xl border border-creamline p-4 sm:p-6 shadow-md">
        <h2 className="text-lg sm:text-xl font-semibold text-graphite font-heading mb-4">CSV Converter Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                setActiveTool(tool.id);
                setCsvData(null);
                setTextInput('');
                setJsonInput('');
              }}
              className={`p-4 text-left border rounded-xl transition-all duration-200 hover:scale-105 ${
                activeTool === tool.id
                  ? 'bg-ink text-white border-ink shadow-md'
                  : 'bg-milk border-creamline text-graphite hover:bg-matcha hover:bg-opacity-20 hover:border-matcha'
              }`}
            >
              <div className="flex items-start space-x-3">
                <span className="text-2xl">{tool.icon}</span>
                <div>
                  <div className="font-medium font-heading">{tool.label}</div>
                  <div className={`text-sm mt-1 font-body ${activeTool === tool.id ? 'text-white opacity-80' : 'text-mist'}`}>
                    {tool.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Active Tool Content */}
      {activeTool === 'upload' && renderUploadTool()}
      {activeTool === 'text' && renderTextTool()}
      {activeTool === 'json' && renderJsonTool()}

      {/* Data Preview */}
      {csvData && renderDataTable()}
    </div>
  );
};

export default CSVConverter; 