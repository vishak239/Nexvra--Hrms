import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight } from "./icons";

// Stitch data tables: tinted header row, uppercase 11px labels, 44px rows with a hover tint.
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-body-md">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="h-10 bg-surface-container-high/60">{children}</tr>
    </thead>
  );
}

export function Th({ children, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-space-md py-2 text-left font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="divide-y divide-surface-container-high/40 [&>tr:hover]:bg-surface-container/60 [&>tr]:transition-colors">
      {children}
    </tbody>
  );
}

export function Td({ children, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`whitespace-nowrap px-space-md py-3 text-on-surface ${className}`} {...rest}>
      {children}
    </td>
  );
}

/** Page numbers to show: first, last, and the current page with one neighbour each side. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

const PAGE_BUTTON =
  "inline-flex h-8 min-w-8 items-center justify-center rounded px-2 font-label-sm text-label-sm transition-colors";

export function Pagination({
  page,
  pageSize,
  count,
  onPage,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-space-sm bg-surface-container-high/40 px-space-md py-space-sm sm:flex-row">
      <span className="text-body-sm text-on-surface-variant">
        Showing <span className="font-semibold text-primary">{from}–{to}</span> of{" "}
        <span className="font-semibold text-primary">{count}</span>
      </span>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button
          className={`${PAGE_BUTTON} bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:pointer-events-none disabled:opacity-30`}
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-on-surface-variant">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              className={`${PAGE_BUTTON} ${
                p === page
                  ? "bg-primary-container font-semibold text-on-primary-fixed"
                  : "bg-surface-container text-on-surface hover:bg-surface-container-high"
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          className={`${PAGE_BUTTON} bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:pointer-events-none disabled:opacity-30`}
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          <ChevronRight className="h-[18px] w-[18px]" />
        </button>
      </nav>
    </div>
  );
}

export const PAGE_SIZE = 25;
