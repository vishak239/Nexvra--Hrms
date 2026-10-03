"use client";

import { Download, Eye, EyeOff, FileText, Trash2, Upload } from "@/components/ui/icons";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, PageHeader } from "@/components/ui/Display";
import { CheckboxField, FilterSelect, SelectField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, FormError, Loading, NoAccess, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtBytes, fmtDate, humanize } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { CompanySettings, DocumentCategory, Employee, EmployeeDocument, Paginated } from "@/lib/types";

const CATEGORIES: DocumentCategory[] = [
  "OFFER_LETTER",
  "APPOINTMENT_LETTER",
  "CERTIFICATE",
  "ID_DOCUMENT",
  "PAYSLIP",
  "EXPERIENCE_LETTER",
  "RELIEVING_LETTER",
  "OTHER",
];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx";

function UploadModal({
  open,
  manage,
  defaultEmployee,
  ownEmployeeId,
  maxMb,
  onClose,
  onDone,
}: {
  open: boolean;
  manage: boolean;
  defaultEmployee: string;
  ownEmployeeId?: number;
  maxMb: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const people = useResource<Paginated<Employee>>(open && manage ? "/api/employees/" : null, { page_size: 100 });
  const [form, setForm] = useState({ employee: "", category: "OFFER_LETTER", title: "", visible: true });
  const [file, setFile] = useState<File | null>(null);
  const { run, pending, error, setError } = useAction();

  useEffect(() => {
    if (open) {
      setError(undefined);
      setFile(null);
      setForm({
        employee: manage ? defaultEmployee : String(ownEmployeeId ?? ""),
        category: manage ? "OFFER_LETTER" : "CERTIFICATE",
        title: "",
        visible: true,
      });
    }
  }, [open, manage, defaultEmployee, ownEmployeeId, setError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.append("employee", form.employee);
    body.append("category", form.category);
    body.append("title", form.title || file.name);
    body.append("visible_to_employee", String(form.visible));
    body.append("file", file);
    const ok = await run(() => api("/api/documents/", { method: "POST", body }));
    if (ok) {
      toast("Document uploaded.");
      onDone();
    }
  }
  const f = error?.fields ?? {};
  const tooBig = !!file && file.size > maxMb * 1024 * 1024;

  return (
    <Modal
      open={open}
      title="Upload document"
      description={`PDF, PNG, JPG or DOCX, up to ${maxMb} MB. Files are stored privately.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="upload-form" loading={pending} disabled={!file || !form.employee || tooBig}>
            Upload
          </Button>
        </>
      }
    >
      <form id="upload-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error} />
        {manage && (
          <SelectField label="Employee" value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })} error={f.employee} required>
            <option value="">Select an employee</option>
            {people.data?.results.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.employee_code})
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} error={f.category}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </SelectField>
        <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={f.title} hint="Defaults to the file name." />
        <TextField
          label="File"
          type="file"
          accept={ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          error={tooBig ? `This file is larger than ${maxMb} MB.` : f.file}
          className="[&_input]:py-2 [&_input]:h-auto"
          required
        />
        {manage && (
          <CheckboxField
            label="Visible to the employee"
            hint="The employee is notified when a visible document is shared."
            checked={form.visible}
            onChange={(e) => setForm({ ...form, visible: e.target.checked })}
          />
        )}
      </form>
    </Modal>
  );
}

function DocumentsContent() {
  const { can, me } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const manage = can("documents.manage");
  const viewAll = can("documents.view_all");
  const [employee, setEmployee] = useState(params.get("employee") ?? "");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = useResource<CompanySettings>("/api/settings/");
  const people = useResource<Paginated<Employee>>(viewAll ? "/api/employees/" : null, { page_size: 100 });
  const { data, error, loading, reload } = useResource<Paginated<EmployeeDocument>>("/api/documents/", {
    employee: viewAll ? employee : undefined,
    category,
    page,
    page_size: PAGE_SIZE,
  });

  if (!can("documents.view_own", "documents.view_all")) return <NoAccess />;
  const selfUpload = !manage && !!settings.data?.employee_document_upload_enabled && !!me?.employee;
  const maxMb = settings.data?.max_upload_size_mb ?? 10;

  async function toggleVisibility(d: EmployeeDocument) {
    const r = await tryApi(() => api(`/api/documents/${d.id}/`, { method: "PATCH", body: { visible_to_employee: !d.visible_to_employee } }));
    toast(r.ok ? (d.visible_to_employee ? "Hidden from employee." : "Shared with employee.") : r.error.message, r.ok ? "success" : "error");
    reload();
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description={viewAll ? "Employee documents. Downloads are logged." : "Documents HR has shared with you."}
        actions={
          (manage || selfUpload) && (
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setUploading(true)}>
              Upload document
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-surface-container-high/40 p-4 sm:flex-row">
          {viewAll && (
            <FilterSelect label="Employee" value={employee} onChange={(e) => { setEmployee(e.target.value); setPage(1); }}>
              <option value="">All employees</option>
              {people.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </FilterSelect>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data?.results.length ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" description={viewAll ? "Upload offer letters, certificates and other HR documents." : "Nothing has been shared with you yet."} />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Document</Th>
                {viewAll && <Th>Employee</Th>}
                <Th>Category</Th>
                <Th>Uploaded</Th>
                {viewAll && <Th>Visibility</Th>}
                <Th className="text-right">Actions</Th>
              </THead>
              <TBody>
                {data.results.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <p className="font-medium text-primary">{d.title}</p>
                      <p className="text-xs text-on-surface-variant">
                        {d.original_filename} · {fmtBytes(d.size)}
                      </p>
                    </Td>
                    {viewAll && <Td>{d.employee_detail.full_name}</Td>}
                    <Td>{humanize(d.category)}</Td>
                    <Td>
                      {fmtDate(d.created_at)}
                      {d.uploaded_by_name && <p className="text-xs text-on-surface-variant">by {d.uploaded_by_name}</p>}
                    </Td>
                    {viewAll && <Td>{d.visible_to_employee ? <Badge tone="green">Shared</Badge> : <Badge>HR only</Badge>}</Td>}
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <a
                          href={`/api/documents/${d.id}/download/`}
                          className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                          aria-label={`Download ${d.title}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        {manage && (
                          <>
                            <button onClick={() => void toggleVisibility(d)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary" aria-label={d.visible_to_employee ? `Hide ${d.title} from employee` : `Share ${d.title} with employee`}>
                              {d.visible_to_employee ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                            <button onClick={() => setDeleting(d)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-error-container/25 hover:text-error" aria-label={`Delete ${d.title}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </>
        )}
      </Card>

      <UploadModal
        open={uploading}
        manage={manage}
        defaultEmployee={employee}
        ownEmployeeId={me?.employee?.id}
        maxMb={maxMb}
        onClose={() => setUploading(false)}
        onDone={() => {
          setUploading(false);
          reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete document?"
        message={deleting ? `"${deleting.title}" will be permanently deleted.` : ""}
        confirmLabel="Delete"
        danger
        pending={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          const r = await tryApi(() => api(`/api/documents/${deleting.id}/`, { method: "DELETE" }));
          setBusy(false);
          toast(r.ok ? "Document deleted." : r.error.message, r.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DocumentsContent />
    </Suspense>
  );
}
