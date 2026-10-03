"use client";

import { Camera, Trash2 } from "@/components/ui/icons";
import { useRef, useState, type ReactNode } from "react";
import { Avatar, Badge, Card, CardHeader, DetailList, StatusBadge } from "@/components/ui/Display";
import { useToast } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import { fmtDate, humanize } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Employee } from "@/lib/types";

export function EmployeeProfile({
  employee,
  actions,
  canEditPhoto,
  onChange,
}: {
  employee: Employee;
  actions?: ReactNode;
  canEditPhoto?: boolean;
  onChange?: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction();
  const confidential = employee.phone !== undefined;
  // Bumped after each upload/removal so the <img> refetches the private (no-store) photo.
  const [photoVersion, setPhotoVersion] = useState(0);
  const photoUrl = employee.has_photo ? `/api/employees/${employee.id}/photo/?v=${photoVersion}` : null;

  async function upload(file: File) {
    const body = new FormData();
    body.append("photo", file);
    const ok = await run(() => api(`/api/employees/${employee.id}/photo/`, { method: "POST", body }));
    if (ok) {
      toast("Photo updated.");
      setPhotoVersion((v) => v + 1);
      onChange?.();
    } else {
      toast("Photo must be a PNG or JPG image within the size limit.", "error");
    }
  }

  async function removePhoto() {
    const ok = await run(() => api(`/api/employees/${employee.id}/photo/`, { method: "DELETE" }).then(() => true));
    if (ok) {
      toast("Photo removed.");
      setPhotoVersion((v) => v + 1);
      onChange?.();
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar name={employee.full_name} src={photoUrl} size={72} />
              {canEditPhoto && (
                <>
                  <button
                    onClick={() => fileInput.current?.click()}
                    disabled={pending}
                    className="absolute -bottom-1 -right-1 rounded-[50%] border border-surface-container-high bg-surface-container p-1.5 text-on-surface hover:bg-surface-container-high"
                    aria-label="Change photo"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-primary">{employee.full_name}</h1>
              <p className="text-sm text-on-surface-variant">
                {employee.designation?.name ?? "No designation"} · {employee.department?.name ?? "No department"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="dark">{employee.employee_code}</Badge>
                <StatusBadge status={employee.employment_status} />
                {employee.role && <Badge>{humanize(employee.role)}</Badge>}
                {employee.is_active === false && <Badge tone="red">Sign-in disabled</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditPhoto && employee.has_photo && (
              <button
                onClick={removePhoto}
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-error"
              >
                <Trash2 className="h-4 w-4" /> Remove photo
              </button>
            )}
            {actions}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Employment" />
          <div className="p-5">
            <DetailList
              items={[
                { label: "Work email", value: employee.email },
                { label: "Username", value: employee.username ? `@${employee.username}` : null },
                { label: "Employee ID", value: employee.employee_code },
                { label: "Department", value: employee.department?.name },
                { label: "Designation", value: employee.designation?.name },
                { label: "Reporting manager", value: employee.manager?.full_name },
                { label: "Employment type", value: humanize(employee.employment_type) },
                { label: "Joining date", value: fmtDate(employee.joining_date) },
                ...(confidential ? [{ label: "Exit date", value: fmtDate(employee.exit_date) }] : []),
              ]}
            />
          </div>
        </Card>

        {confidential && (
          <Card>
            <CardHeader title="Contact & emergency" description="Confidential. Visible to the employee and HR." />
            <div className="p-5">
              <DetailList
                items={[
                  { label: "Phone", value: employee.phone },
                  { label: "Address", value: employee.address ? <span className="whitespace-pre-line">{employee.address}</span> : null },
                  { label: "Emergency contact", value: employee.emergency_contact_name },
                  { label: "Emergency phone", value: employee.emergency_contact_phone },
                  { label: "Relationship", value: employee.emergency_contact_relation },
                ]}
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
