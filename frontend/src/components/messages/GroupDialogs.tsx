"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar, Badge, photoUrl } from "@/components/ui/Display";
import { TextField } from "@/components/ui/Field";
import { Check, LogOut, Search, Trash2, X } from "@/components/ui/icons";
import { ConfirmDialog, Modal, useToast } from "@/components/ui/Overlay";
import { FormError, Spinner } from "@/components/ui/States";
import { api } from "@/lib/api";
import { toApiError, useAction } from "@/lib/hooks";
import type { Conversation, Person } from "@/lib/types";

export const GROUP_MIN_OTHERS = 2;
const NAME_MIN = 2;
const NAME_MAX = 80;

const photoOf = (p: Person | null | undefined) => photoUrl(p?.employee_id, p?.photo_version, !!p?.has_photo);

/** Find colleagues (directory search) and tick several; already-chosen people show as chips. */
function PeoplePicker({ selected, onChange, exclude = [] }: { selected: Person[]; onChange: (p: Person[]) => void; exclude?: number[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const r = await api<{ results: Person[] }>("/api/messages/people/", { params: { q: q.trim() || undefined } });
        if (alive) {
          setResults(r.results.filter((p) => !exclude.includes(p.user_id)));
          setError(null);
        }
      } catch (e) {
        if (alive) setError(toApiError(e).message);
      }
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exclude.join(",")]);

  const chosen = new Set(selected.map((p) => p.user_id));
  const toggle = (p: Person) => onChange(chosen.has(p.user_id) ? selected.filter((s) => s.user_id !== p.user_id) : [...selected, p]);

  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">Find colleagues by @username, Employee ID or name</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find @username, Employee ID or name"
          className="h-10 w-full rounded-lg border border-surface-container-high bg-surface-container-lowest pl-9 pr-3 text-sm text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
        />
      </label>
      <ul className="max-h-56 divide-y divide-surface-container-high/40 overflow-y-auto rounded-lg border border-surface-container-high" aria-label="Colleagues">
        {error ? (
          <li className="px-3 py-2 text-sm text-error">{error}</li>
        ) : results === null ? (
          <li className="flex items-center gap-2 px-3 py-2 text-sm text-on-surface-variant">
            <Spinner className="h-4 w-4" /> Loading…
          </li>
        ) : !results.length ? (
          <li className="px-3 py-2 text-sm text-on-surface-variant">No one found.</li>
        ) : (
          results.map((p) => {
            const on = chosen.has(p.user_id);
            return (
              <li key={p.user_id}>
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  aria-label={p.full_name}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-container"
                >
                  <Avatar name={p.full_name} src={photoOf(p)} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary">{p.full_name}</span>
                    <span className="block truncate text-xs text-on-surface-variant">
                      {[p.username && `@${p.username}`, p.designation].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-primary-container bg-primary-container text-on-primary-fixed" : "border-surface-container-high"}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function SelectedPeople({ people, onRemove }: { people: Person[]; onRemove: (p: Person) => void }) {
  if (!people.length) return <p className="text-body-sm text-on-surface-variant">No one selected yet.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Selected members">
      {people.map((p) => (
        <li key={p.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high py-1 pl-1 pr-2 text-body-sm text-on-surface">
          <Avatar name={p.full_name} src={photoOf(p)} size={22} />
          {p.full_name}
          <button type="button" onClick={() => onRemove(p)} aria-label={`Remove ${p.full_name}`} className="text-on-surface-variant hover:text-on-surface">
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CreateGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Conversation) => void }) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [name, setName] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [step, setStep] = useState<"pick" | "review">("pick");

  useEffect(() => {
    if (!open) return;
    setName("");
    setPeople([]);
    setStep("pick");
    setError(undefined);
  }, [open, setError]);

  const trimmed = name.trim();
  const nameOk = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
  const enough = people.length >= GROUP_MIN_OTHERS;
  const f = error?.fields ?? {};

  async function create(e: FormEvent) {
    e.preventDefault();
    if (step === "pick") {
      if (nameOk && enough) setStep("review");
      return;
    }
    const group = await run(() => api<Conversation>("/api/messages/groups/", { body: { name: trimmed, user_ids: people.map((p) => p.user_id) } }));
    if (group) {
      toast(`Group "${group.name}" created.`);
      onCreated(group);
    }
  }

  return (
    <Modal
      open={open}
      title={step === "pick" ? "Create group" : "Review group"}
      description={step === "pick" ? `Name the group and choose at least ${GROUP_MIN_OTHERS} colleagues. Only members can read it.` : "Check the name and members, then create the group."}
      onClose={onClose}
      footer={
        <>
          {step === "review" ? (
            <Button variant="secondary" onClick={() => setStep("pick")} disabled={pending}>
              Back
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" form="create-group-form" loading={pending} disabled={!nameOk || !enough}>
            {step === "pick" ? "Review" : "Create group"}
          </Button>
        </>
      }
    >
      <form id="create-group-form" onSubmit={create} className="space-y-4" noValidate>
        <FormError error={error && !Object.keys(f).length ? error : undefined} />
        {step === "pick" ? (
          <>
            <TextField
              label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              error={f.name ?? (name && !nameOk ? `${NAME_MIN}-${NAME_MAX} characters.` : undefined)}
              required
            />
            <div className="space-y-2">
              <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Members ({people.length} selected)</p>
              <SelectedPeople people={people} onRemove={(p) => setPeople(people.filter((x) => x.user_id !== p.user_id))} />
              <PeoplePicker selected={people} onChange={setPeople} />
              {f.user_ids && <p className="text-body-sm text-error">{f.user_ids.join(" ")}</p>}
            </div>
          </>
        ) : (
          <div className="space-y-3" data-testid="group-review">
            <p className="text-body-md text-on-surface">
              <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">Group</span>
              <br />
              <strong>{trimmed}</strong> · {people.length + 1} members including you
            </p>
            <ul className="divide-y divide-surface-container-high/40 rounded-lg border border-surface-container-high" aria-label="Members to add">
              {people.map((p) => (
                <li key={p.user_id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={p.full_name} src={photoOf(p)} size={28} />
                  <span className="text-sm text-on-surface">{p.full_name}</span>
                </li>
              ))}
            </ul>
            {f.user_ids && <p className="text-body-sm text-error">{f.user_ids.join(" ")}</p>}
          </div>
        )}
      </form>
    </Modal>
  );
}

export function GroupMembersModal({
  open,
  conversation,
  meId,
  onClose,
  onChanged,
  onLeft,
}: {
  open: boolean;
  conversation: Conversation;
  meId: number;
  onClose: () => void;
  onChanged: (c: Conversation) => void;
  onLeft: () => void;
}) {
  const toast = useToast();
  const action = useAction();
  const owner = conversation.my_role === "OWNER";
  const [adding, setAdding] = useState<Person[]>([]);
  const [name, setName] = useState(conversation.name);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAdding([]);
    setName(conversation.name);
    action.setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversation.id]);

  async function save<T>(fn: () => Promise<T>, done: string) {
    const r = await action.run(fn);
    if (r) toast(done);
    return r;
  }

  return (
    <>
      <Modal open={open && !leaving} title={conversation.name} description={`${conversation.member_count} members`} onClose={onClose}>
        <div className="space-y-5">
          <FormError error={action.error} />
          {owner && (
            <form
              className="flex items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const c = await save(() => api<Conversation>(`/api/messages/conversations/${conversation.id}/`, { method: "PATCH", body: { name } }), "Group renamed.");
                if (c) onChanged(c);
              }}
            >
              <TextField className="flex-1" label="Group name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={name.trim() === conversation.name || name.trim().length < NAME_MIN}>
                Rename
              </Button>
            </form>
          )}
          <ul className="divide-y divide-surface-container-high/40 rounded-lg border border-surface-container-high" aria-label="Group members">
            {conversation.members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                <Avatar name={m.full_name} src={photoOf(m)} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-primary">
                    {m.full_name}
                    {m.user_id === meId && <span className="text-on-surface-variant"> (you)</span>}
                  </span>
                  <span className="block truncate text-xs text-on-surface-variant">{[m.username && `@${m.username}`, m.designation].filter(Boolean).join(" · ")}</span>
                </span>
                {m.role === "OWNER" && <Badge tone="lime">Owner</Badge>}
                {owner && m.user_id !== meId && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.full_name}`}
                    className="rounded-md p-1.5 text-on-surface-variant hover:bg-error-container/25 hover:text-error"
                    onClick={async () => {
                      const c = await save(
                        () => api<Conversation>(`/api/messages/conversations/${conversation.id}/members/${m.user_id}/`, { method: "DELETE" }),
                        `${m.full_name} removed.`,
                      );
                      if (c) onChanged(c);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {owner && (
            <div className="space-y-2">
              <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Add members</p>
              <SelectedPeople people={adding} onRemove={(p) => setAdding(adding.filter((x) => x.user_id !== p.user_id))} />
              <PeoplePicker selected={adding} onChange={setAdding} exclude={conversation.members.map((m) => m.user_id)} />
              <Button
                variant="secondary"
                disabled={!adding.length}
                loading={action.pending}
                onClick={async () => {
                  const c = await save(
                    () => api<Conversation>(`/api/messages/conversations/${conversation.id}/members/`, { body: { user_ids: adding.map((p) => p.user_id) } }),
                    "Members added.",
                  );
                  if (c) {
                    setAdding([]);
                    onChanged(c);
                  }
                }}
              >
                Add {adding.length || ""} {adding.length === 1 ? "member" : "members"}
              </Button>
            </div>
          )}
          <div className="flex justify-end border-t border-surface-container-high/40 pt-4">
            <Button variant="danger" icon={<LogOut className="h-4 w-4" />} onClick={() => setLeaving(true)}>
              Leave group
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={leaving}
        title="Leave this group?"
        message={owner ? "You are the owner; the longest-standing member becomes the owner. You will no longer see the conversation." : "You will no longer see the conversation or its files."}
        confirmLabel="Leave group"
        danger
        pending={action.pending}
        onConfirm={async () => {
          const ok = await action.run(() => api(`/api/messages/conversations/${conversation.id}/members/${meId}/`, { method: "DELETE" }).then(() => true));
          setLeaving(false);
          if (ok) {
            toast("You left the group.");
            onLeft();
          }
        }}
        onClose={() => setLeaving(false)}
      />
    </>
  );
}
