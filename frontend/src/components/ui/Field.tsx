import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Search } from "./icons";

// Stitch inputs: dark well, 1px border, lime focus stroke (DESIGN.md "Input Fields & Controls").
const CONTROL =
  "block w-full rounded border bg-surface-container-lowest px-3 text-body-md text-on-surface " +
  "placeholder:text-on-surface-variant/60 transition-colors focus:border-primary-container focus:outline-none " +
  "focus:ring-1 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60";
const HEIGHT = "h-11 sm:h-9";

function controlClass(error?: string[] | string) {
  return `${CONTROL} ${error ? "border-error" : "border-surface-container-high"}`;
}

/** Native select with the Stitch chevron (appearance-none + icon). */
function SelectControl({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`${className} cursor-pointer appearance-none pr-9`} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-on-surface-variant" />
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string[] | string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
}

export function Field({ label, error, hint, required, className = "", children }: FieldProps) {
  const id = useId();
  const message = Array.isArray(error) ? error.join(" ") : error;
  const describedBy = message ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block font-label-sm text-label-sm uppercase text-on-surface-variant">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      {children(id, describedBy, !!message)}
      {message ? (
        <p id={`${id}-error`} className="mt-1.5 text-body-sm text-error">
          {message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-body-sm text-on-surface-variant">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; error?: string[] | string; hint?: string; className?: string };

export function TextField({ label, error, hint, className, required, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy, invalid) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          className={`${controlClass(error)} ${HEIGHT}`}
          {...rest}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className,
  required,
  children,
  ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy, invalid) => (
        <SelectControl
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          className={`${controlClass(error)} ${HEIGHT}`}
          {...rest}
        >
          {children}
        </SelectControl>
      )}
    </Field>
  );
}

export function TextAreaField({ label, error, hint, className, required, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id, describedBy, invalid) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          rows={3}
          className={`${controlClass(error)} py-2`}
          {...rest}
        />
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  hint,
  className = "",
  ...rest
}: { label: string; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 cursor-pointer rounded-sm accent-primary-container"
        {...rest}
      />
      <div>
        <label htmlFor={id} className="text-body-md font-medium text-on-surface">
          {label}
        </label>
        {hint && <p className="text-body-sm text-on-surface-variant">{hint}</p>}
      </div>
    </div>
  );
}

/** Plain search/filter input without a visible label (label provided for screen readers). */
export function SearchInput({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-on-surface-variant" />
      <input aria-label={label} placeholder={label} className={`${controlClass()} ${HEIGHT} pl-9`} {...rest} />
    </div>
  );
}

export function FilterSelect({ label, children, ...rest }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="w-full sm:w-48">
      <SelectControl aria-label={label} className={`${controlClass()} ${HEIGHT}`} {...rest}>
        {children}
      </SelectControl>
    </div>
  );
}
