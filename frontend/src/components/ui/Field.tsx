import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const CONTROL =
  "block w-full rounded-lg border bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 " +
  "focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-500";

function controlClass(error?: string[] | string) {
  return `${CONTROL} ${error ? "border-red-400" : "border-zinc-300"}`;
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
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children(id, describedBy, !!message)}
      {message ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-red-600">
          {message}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-zinc-500">
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
          className={`${controlClass(error)} h-10`}
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
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          className={`${controlClass(error)} h-10 pr-8`}
          {...rest}
        >
          {children}
        </select>
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
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 accent-zinc-900"
        {...rest}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-zinc-800">
          {label}
        </label>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
    </div>
  );
}

/** Plain search/filter input without a visible label (label provided for screen readers). */
export function SearchInput({ label, ...rest }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <input aria-label={label} placeholder={label} className={`${controlClass()} h-10 sm:w-64`} {...rest} />;
}

export function FilterSelect({ label, children, ...rest }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select aria-label={label} className={`${controlClass()} h-10 pr-8 sm:w-48`} {...rest}>
      {children}
    </select>
  );
}
