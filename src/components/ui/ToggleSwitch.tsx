import React from 'react';

interface ToggleSwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  srLabel?: boolean;
  /**
   * Optional custom classes for the label text span
   */
  labelClassName?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  id,
  label,
  checked,
  onChange,
  srLabel = false,
  labelClassName,
  ...rest
}) => {
  return (
    <div className="flex items-center">
      <label htmlFor={id} className="relative inline-flex cursor-pointer items-center">
        {srLabel && <span className="sr-only">{label}</span>}
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          {...rest}
        />
        <div className="peer h-5 w-9 rounded-full bg-line-strong peer-checked:bg-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:border after:border-line after:bg-surface after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-on-action"></div>
        {!srLabel && (
          <span className={labelClassName ? `ml-3 ${labelClassName}` : "ml-3 text-sm font-medium text-fg-soft"}>
            {label}
          </span>
        )}
      </label>
    </div>
  );
};
