import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '../utils/imageCompression';
import ToolIcon from './ToolIcon';

export default function MediaUpload({
  kind,
  onSelect,
  disabled = false,
  maxBytes = 100 * 1024 * 1024,
}: {
  kind: 'image' | 'video';
  onSelect: (file: File) => void;
  disabled?: boolean;
  maxBytes?: number;
}) {
  const [error, setError] = useState('');
  const onDrop = useCallback(
    (files: File[]) => {
      if (files[0]) {
        setError('');
        onSelect(files[0]);
      }
    },
    [onSelect],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    multiple: false,
    maxSize: maxBytes,
    accept:
      kind === 'image'
        ? {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
          }
        : { 'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi'] },
    onDropRejected: (rejections) =>
      setError(
        rejections.some((r) =>
          r.errors.some((e) => e.code === 'file-too-large'),
        )
          ? `Choose a file smaller than ${formatBytes(maxBytes)}.`
          : `Choose one supported ${kind} file.`,
      ),
  });
  return (
    <>
      <div
        {...getRootProps({
          role: 'button',
          'aria-label': `Choose ${kind}`,
          className: `media-dropzone ${isDragActive ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`,
        })}
      >
        <input {...getInputProps({ 'aria-label': `Choose ${kind} file` })} />
        <div className="upload-art" aria-hidden="true">
          <span className="art-file back">
            <ToolIcon name={kind} size={32} />
          </span>
          <span className="art-file front">
            <ToolIcon name={kind} size={32} />
          </span>
          <span className="art-plus">+</span>
        </div>
        <h2>
          {isDragActive ? 'Drop it here' : `A lighter ${kind} starts here`}
        </h2>
        <p>Drag and drop your {kind}, or browse your files.</p>
        <span className="primary-button choose-file">
          <ToolIcon name="upload" size={17} />
          Choose {kind}
        </span>
        <small>
          {kind === 'image' ? 'JPG, PNG, WebP' : 'MP4, MOV, WebM, MKV, AVI'}
          <span>·</span>Up to {formatBytes(maxBytes)}
        </small>
      </div>
      {error && (
        <p role="alert" className="error-notice">
          {error}
        </p>
      )}
    </>
  );
}
