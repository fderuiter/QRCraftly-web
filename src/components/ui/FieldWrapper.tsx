import React from "react";
import { CharCount } from "../CharCount";
import { useFieldIds } from "../../hooks/useFieldIds";

export interface BaseFieldProps {
  label?: string;
  contextualLabel?: string;
  id?: string;
  className?: string; // wrapper className
  inputClassName?: string; // input element className override
  labelClassName?: string; // optional override
  error?: string;
}

const getLabelClass = (customClass?: string) => {
  if (customClass) return customClass;
  return "block text-sm font-medium text-fg-soft mb-1";
};

export interface FieldWrapperProps extends BaseFieldProps {
  showCharCount?: boolean;
  maxLength?: number;
  value?: string | number | readonly string[];
  children: React.ReactNode;
  inputId: string;
  errorId?: string;
  charCountId?: string;
  isCheckbox?: boolean;
}

export const FieldWrapper: React.FC<FieldWrapperProps> = ({
  inputId,
  label,
  contextualLabel,
  className,
  labelClassName,
  showCharCount,
  maxLength,
  value,
  children,
  error,
  errorId,
  charCountId,
  isCheckbox,
}) => {
  if (isCheckbox) {
    return (
      <div className={className}>
        <label
          htmlFor={inputId}
          className={`flex min-h-6 cursor-pointer items-center gap-2 ${getLabelClass(labelClassName).replace("mb-1", "")}`}
        >
          {children}
          {label && <span>{label}</span>}
          {contextualLabel && (
            <span className="text-xs font-normal text-fg-muted">
              ({contextualLabel})
            </span>
          )}
        </label>
        {error && (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className={getLabelClass(labelClassName)}>
          {label}
          {contextualLabel && (
            <span className="ml-2 text-xs font-normal text-fg-muted">
              ({contextualLabel})
            </span>
          )}
        </label>
      )}
      {children}
      {showCharCount && maxLength && (
        <CharCount id={charCountId} current={String(value !== undefined && value !== null ? value : "").length} max={maxLength} />
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

export interface FormFieldRenderProps {
  inputId: string;
  describedBy?: string;
  errorId?: string;
  charCountId?: string;
}

export interface FormFieldContainerProps extends BaseFieldProps {
  showCharCount?: boolean;
  maxLength?: number;
  value?: string | number | readonly string[];
  isCheckbox?: boolean;
  ariaDescribedby?: string;
  "aria-describedby"?: string;
  children?: React.ReactNode | ((props: FormFieldRenderProps) => React.ReactNode);
  render?: (props: FormFieldRenderProps) => React.ReactNode;
}

export const FormFieldContainer: React.FC<FormFieldContainerProps> = ({
  id,
  label,
  contextualLabel,
  className,
  labelClassName,
  error,
  showCharCount,
  maxLength,
  value,
  isCheckbox,
  ariaDescribedby,
  "aria-describedby": ariaDescribedByHyphen,
  children,
  render,
}) => {
  const resolvedAriaDescribedby = ariaDescribedby ?? ariaDescribedByHyphen;
  const { inputId, errorId, charCountId, describedBy } = useFieldIds({
    id,
    error,
    showCharCount,
    maxLength,
    ariaDescribedby: resolvedAriaDescribedby,
  });

  const renderProps: FormFieldRenderProps = {
    inputId,
    describedBy,
    errorId,
    charCountId,
  };

  const content = render
    ? render(renderProps)
    : typeof children === "function"
      ? children(renderProps)
      : children;

  return (
    <FieldWrapper
      inputId={inputId}
      label={label}
      contextualLabel={contextualLabel}
      className={className}
      labelClassName={labelClassName}
      showCharCount={showCharCount}
      maxLength={maxLength}
      value={value}
      error={error}
      errorId={errorId}
      charCountId={charCountId}
      isCheckbox={isCheckbox}
    >
      {content}
    </FieldWrapper>
  );
};

