import React, { useState, useRef, useEffect } from 'react';
import { Tooltip } from './Tooltip';
import { normalizeHex } from '../../utils/colorUtils';
import { FieldWrapper } from './FieldWrapper';
import { mergeClasses, ERROR_INPUT_CLASSES } from './styles';

/**
 * Helper component for color inputs to reduce duplication.
 */
interface ColorInputProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  displayValue?: string;
  sizeClass?: string;
  title?: string;
  disabled?: boolean;
  error?: string;
  hideLabel?: boolean;
}

export const ColorInput: React.FC<ColorInputProps> = ({
  id,
  label,
  value,
  onChange,
  displayValue,
  sizeClass = "w-10 h-10",
  title,
  disabled = false,
  error,
  hideLabel = false,
}) => {
  const [textValue, setTextValue] = useState(displayValue || value);
  const textValueRef = useRef(textValue);

  // Keep ref updated with latest textValue for use in useEffect
  useEffect(() => {
    textValueRef.current = textValue;
  }, [textValue]);

  // Sync textValue when prop value changes, but avoid overwriting user input while typing
  useEffect(() => {
    const currentText = textValueRef.current;
    const currentNormalized = normalizeHex(currentText);
    const propNormalized = normalizeHex(displayValue || value);

    // Only update textValue if the prop value is different from what we currently have
    // (after normalization). This prevents overwriting shorthand inputs (e.g. "#123")
    // with the expanded version ("#112233") while the user is typing.
    if (currentNormalized !== propNormalized) {
      setTextValue(displayValue || value);
    }
  }, [value, displayValue]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setTextValue(newVal);

    // Validate and trigger change if valid hex
    const normalized = normalizeHex(newVal);
    if (normalized) {
      onChange(normalized);
    }
  };

  const errorId = error ? `${id}-error` : undefined;
  const swatch = (
    <input
      id={id}
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`${sizeClass} rounded border-0 bg-transparent p-0 disabled:opacity-50 ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  );
  const cleanLabel = label?.trim();

  return (
    <FieldWrapper
      inputId={id}
      label={label}
      error={error}
      errorId={errorId}
      labelClassName={hideLabel ? "sr-only" : undefined}
    >
      <div className="-m-1 flex items-center gap-2 rounded-lg p-1">
        {title ? <Tooltip content={title}>{swatch}</Tooltip> : swatch}
        <input
          type="text"
          value={textValue}
          onChange={handleTextChange}
          disabled={disabled}
          className={mergeClasses(
            "w-24 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-sm text-fg-muted transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50",
            error ? ERROR_INPUT_CLASSES : undefined
          )}
          aria-label={cleanLabel ? `${cleanLabel} Hex Code` : "Hex Code"}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </div>
    </FieldWrapper>
  );
};
