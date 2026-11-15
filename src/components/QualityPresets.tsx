import React, { useId } from 'react';
import { CompressionPreset } from '../utils/imageCompression';

export default function QualityPresets({
  value,
  onChange,
  disabled = false,
  lossless = false,
}: {
  value: CompressionPreset;
  onChange: (value: CompressionPreset) => void;
  disabled?: boolean;
  lossless?: boolean;
}) {
  const groupName = useId();
  const options: { value: CompressionPreset; title: string; detail: string }[] =
    [
      {
        value: 'quality',
        title: 'Best quality',
        detail: 'Keep more of the detail',
      },
      {
        value: 'balanced',
        title: 'Balanced',
        detail: 'A little smaller. Still looking good.',
      },
      {
        value: 'small',
        title: 'Smallest file',
        detail: 'More compression, less detail',
      },
    ];
  return (
    <fieldset className="quality-fieldset" disabled={disabled || lossless}>
      <legend className="section-label">Compression level</legend>
      {lossless ? (
        <p className="status-note">
          PNG uses lossless encoding. Resize or choose WebP for smaller files.
        </p>
      ) : (
        options.map((option) => (
          <label
            className={`quality-option ${value === option.value ? 'selected' : ''}`}
            key={option.value}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.title}</strong>
              <small>{option.detail}</small>
            </span>
            {option.value === 'quality' && (
              <span className="mini-tag">RECOMMENDED</span>
            )}
          </label>
        ))
      )}
    </fieldset>
  );
}
