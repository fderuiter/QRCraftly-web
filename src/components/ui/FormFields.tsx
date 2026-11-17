import React from "react";
import { TEXT_AREA_CLASSES, SELECT_CLASSES, ERROR_INPUT_CLASSES, mergeClasses } from "./styles";
import { FormFieldContainer, type BaseFieldProps } from "./FieldWrapper";
export { TextField } from "./TextField";

interface TextAreaFieldProps
  extends
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id">,
    BaseFieldProps {
  showCharCount?: boolean;
}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({
  label,
  contextualLabel,
  id,
  className,
  inputClassName,
  labelClassName,
  showCharCount,
  maxLength,
  value,
  error,
  "aria-describedby": ariaDescribedby,
  ...props
}) => {
  return (
    <FormFieldContainer
      id={id}
      label={label}
      contextualLabel={contextualLabel}
      className={className}
      labelClassName={labelClassName}
      showCharCount={showCharCount}
      maxLength={maxLength}
      value={value}
      error={error}
      ariaDescribedby={ariaDescribedby}
    >
      {({ inputId, describedBy }) => (
        <textarea
          id={inputId}
          maxLength={maxLength}
          className={mergeClasses(
            TEXT_AREA_CLASSES,
            error && ERROR_INPUT_CLASSES,
            inputClassName
          )}
          value={value}
          aria-invalid={!!error}
          {...props}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldContainer>
  );
};

// Select element also has a 'size' attribute (number of visible options), so we omit it here too.
interface SelectFieldProps
  extends
    Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size" | "id">,
    BaseFieldProps {}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  contextualLabel,
  id,
  className,
  inputClassName,
  labelClassName,
  children,
  error,
  "aria-describedby": ariaDescribedby,
  ...props
}) => {
  return (
    <FormFieldContainer
      id={id}
      label={label}
      contextualLabel={contextualLabel}
      className={className}
      labelClassName={labelClassName}
      error={error}
      ariaDescribedby={ariaDescribedby}
    >
      {({ inputId, describedBy }) => (
        <select 
          id={inputId} 
          className={mergeClasses(
            SELECT_CLASSES,
            error && ERROR_INPUT_CLASSES,
            inputClassName
          )} 
          aria-invalid={!!error}
          {...props}
          aria-describedby={describedBy}
        >
          {children}
        </select>
      )}
    </FormFieldContainer>
  );
};

interface CheckboxFieldProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "type">,
    BaseFieldProps {}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  contextualLabel,
  id,
  className,
  labelClassName,
  error,
  "aria-describedby": ariaDescribedby,
  ...props
}) => {
  return (
    <FormFieldContainer
      id={id}
      label={label}
      contextualLabel={contextualLabel}
      className={className}
      labelClassName={labelClassName}
      error={error}
      isCheckbox
      ariaDescribedby={ariaDescribedby}
    >
      {({ inputId, describedBy }) => (
        <input
          id={inputId}
          type="checkbox"
          className="size-5 shrink-0 rounded border-line-strong bg-surface text-action"
          aria-invalid={!!error}
          {...props}
          aria-describedby={describedBy}
        />
      )}
    </FormFieldContainer>
  );
};
