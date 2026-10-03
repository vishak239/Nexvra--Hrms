import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./States";

type Variant = "primary" | "secondary" | "dark" | "danger" | "ghost";
type Size = "sm" | "md";

// Stitch button treatments (see stitch_nexvra_hrms_enterprise_platform/*/code.html).
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary-container text-on-primary-fixed font-semibold hover:bg-primary-fixed-dim",
  secondary: "bg-surface-container-high text-on-surface hover:bg-surface-container-highest hover:text-primary",
  dark: "bg-surface-container-highest text-primary hover:bg-surface-bright",
  danger: "border border-error-container bg-error-container/30 text-error hover:bg-error-container hover:text-on-error-container",
  ghost: "bg-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-label-md gap-1.5",
  md: "h-10 sm:h-9 px-space-lg text-label-lg gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return [
    "inline-flex items-center justify-center rounded font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap",
    VARIANTS[variant],
    SIZES[size],
    extra,
  ].join(" ");
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, children, className = "", disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  icon,
  children,
  className = "",
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}
