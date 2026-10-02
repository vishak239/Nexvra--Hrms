import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-zinc-50">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-zinc-100 bg-white">{children}</tbody>;
}

export function Td({ children, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`whitespace-nowrap px-5 py-3.5 text-zinc-700 ${className}`} {...rest}>
      {children}
    </td>
  );
}

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
    <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
      <span>
        {from}–{to} of {count}
      </span>
      <div className="flex items-center gap-1">
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white disabled:opacity-40"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 text-zinc-700">
          {page} / {pages}
        </span>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white disabled:opacity-40"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export const PAGE_SIZE = 25;
