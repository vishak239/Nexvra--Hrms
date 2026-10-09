"use client";

import { ArrowLeft, Download, FileText, Groups, MessageSquare, Paperclip, Plus, Search, Send, X } from "@/components/ui/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CreateGroupModal, GroupMembersModal } from "@/components/messages/GroupDialogs";
import { ReceiptMark } from "@/components/messages/ReceiptMark";
import { Button } from "@/components/ui/Button";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { Avatar, Card, PageHeader, photoUrl } from "@/components/ui/Display";
import { useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, Loading, NoAccess, Spinner } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtBytes, fmtDateTime, fmtTime } from "@/lib/format";
import { toApiError, useAction } from "@/lib/hooks";
import type { ChatMessage, Conversation, MessageReceipt, Person } from "@/lib/types";

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg";
const MAX_FILES = 5;
const THREAD_POLL_MS = 10_000;
const LIST_POLL_MS = 30_000;

/** Runs `fn` every `ms` only while the tab is visible (no background polling). */
function useVisiblePolling(fn: () => void, ms: number, enabled: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => document.visibilityState === "visible" && ref.current(), ms);
    const onVisible = () => document.visibilityState === "visible" && ref.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}

function personLine(p: Person) {
  return [p.username && `@${p.username}`, p.employee_code, p.designation].filter(Boolean).join(" · ");
}

function photoOf(p: Person | null) {
  return photoUrl(p?.employee_id, p?.photo_version, !!p?.has_photo);
}

/** The conversation's picture: the other person's photo, or a group badge. */
function ConversationAvatar({ c, size }: { c: Conversation; size: number }) {
  if (c.kind === "GROUP") {
    return (
      <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-[50%] bg-surface-container-high text-info" aria-hidden="true">
        <Groups className={size > 32 ? "h-5 w-5" : "h-4 w-4"} />
      </span>
    );
  }
  return <Avatar name={c.other?.full_name ?? "?"} src={photoOf(c.other)} size={size} />;
}

function PeopleSearch({ onPick }: { onPick: (p: Person) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api<{ results: Person[] }>("/api/messages/people/", { params: { q } });
        if (alive) {
          setResults(r.results);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(toApiError(e).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="border-b border-surface-container-high/40 p-3">
      <label className="relative block">
        <span className="sr-only">Find people by @username, Employee ID or name</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find @username, Employee ID or name"
          className="h-10 w-full rounded-lg border border-surface-container-high pl-9 pr-3 text-sm focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
        />
      </label>
      {q.trim() && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-surface-container-high/60" aria-live="polite">
          {loading && !results ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-on-surface-variant">
              <Spinner className="h-4 w-4" /> Searching…
            </p>
          ) : error ? (
            <p className="px-3 py-2 text-sm text-error">{error}</p>
          ) : !results?.length ? (
            <p className="px-3 py-2 text-sm text-on-surface-variant">No one found.</p>
          ) : (
            <ul>
              {results.map((p) => (
                <li key={p.user_id}>
                  <button
                    onClick={() => {
                      onPick(p);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-container"
                    aria-label={`Message ${p.full_name}`}
                  >
                    <Avatar name={p.full_name} src={photoOf(p)} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-primary">{p.full_name}</span>
                      <span className="block truncate text-xs text-on-surface-variant">{personLine(p)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationList({
  conversations,
  activeId,
  onOpen,
}: {
  conversations: Conversation[];
  activeId: number | null;
  onOpen: (id: number) => void;
}) {
  if (!conversations.length) {
    return <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No conversations yet" description="Search for a colleague above to start one." />;
  }
  return (
    <ul className="divide-y divide-surface-container-high/40" aria-label="Conversations">
      {conversations.map((c) => {
        const who = c.last_message ? (c.last_message.is_mine ? "You: " : c.kind === "GROUP" && c.last_message.sender_name ? `${c.last_message.sender_name}: ` : "") : "";
        const preview = c.last_message
          ? `${who}${c.last_message.body || (c.last_message.attachment_count ? `📎 ${c.last_message.attachment_count} file(s)` : "")}`
          : c.kind === "GROUP"
            ? `${c.member_count} members · no messages yet`
            : "";
        return (
          <li key={c.id}>
            <button
              onClick={() => onOpen(c.id)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-container ${activeId === c.id ? "bg-surface-container-high" : ""}`}
              aria-current={activeId === c.id ? "true" : undefined}
            >
              <ConversationAvatar c={c} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread_count ? "font-semibold text-primary" : "font-medium text-on-surface"}`}>{c.name || c.other?.full_name || "Unknown"}</span>
                  <span className="shrink-0 text-[11px] text-outline">{c.last_message_at ? fmtTime(c.last_message_at) : ""}</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-on-surface-variant">{preview}</span>
                  {c.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-container px-1.5 text-[10px] font-bold text-on-primary-fixed" aria-label={`${c.unread_count} unread`}>
                      {c.unread_count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thread({
  conversationId,
  meId,
  onBack,
  onActivity,
  onLeft,
}: {
  conversationId: number;
  meId: number;
  onBack: () => void;
  onActivity: () => void;
  onLeft: () => void;
}) {
  const toast = useToast();
  const [showMembers, setShowMembers] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toApiError> | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const send = useAction();
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;
  const activity = useRef(onActivity);
  activity.current = onActivity;

  const markRead = useCallback(async () => {
    // Seen means seen: only while the conversation is on screen.
    if (document.visibilityState !== "visible") return;
    try {
      await api(`/api/messages/conversations/${conversationId}/read/`, { method: "POST" });
      activity.current();
    } catch {
      // read receipts are best-effort; the next open retries
    }
  }, [conversationId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setError(null);
    Promise.all([
      api<Conversation>(`/api/messages/conversations/${conversationId}/`),
      api<{ results: ChatMessage[]; has_more: boolean }>(`/api/messages/conversations/${conversationId}/messages/`),
    ])
      .then(([c, m]) => {
        if (!alive) return;
        setConversation(c);
        setMessages(m.results);
        setHasMore(m.has_more);
        void markRead();
        window.setTimeout(() => bottom.current?.scrollIntoView?.({ block: "end" }), 0);
      })
      .catch((e) => alive && setError(toApiError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [conversationId, markRead]);

  const fetchNew = useCallback(async () => {
    try {
      const r = await api<{ results: ChatMessage[] }>(`/api/messages/conversations/${conversationId}/messages/`, {
        params: { after: lastId || undefined },
      });
      if (r.results.length) {
        setMessages((m) => [...m, ...r.results.filter((x) => !m.some((y) => y.id === x.id))]);
        void markRead();
        window.setTimeout(() => bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }), 0);
      }
    } catch {
      // transient; the next poll retries
    }
  }, [conversationId, lastId, markRead]);

  const refreshReceipts = useCallback(async () => {
    try {
      const r = await api<{ receipts: Record<string, MessageReceipt> }>(`/api/messages/conversations/${conversationId}/receipts/`);
      setMessages((all) => all.map((m) => (m.is_mine && r.receipts[String(m.id)] ? { ...m, receipt: r.receipts[String(m.id)] } : m)));
    } catch {
      // transient; the next poll retries
    }
  }, [conversationId]);

  useVisiblePolling(
    () => {
      void fetchNew();
      void refreshReceipts();
    },
    THREAD_POLL_MS,
    !loading && !error,
  );

  async function loadOlder() {
    if (!messages.length) return;
    setLoadingOlder(true);
    try {
      const r = await api<{ results: ChatMessage[]; has_more: boolean }>(`/api/messages/conversations/${conversationId}/messages/`, {
        params: { before: messages[0].id },
      });
      setMessages((m) => [...r.results, ...m]);
      setHasMore(r.has_more);
    } catch (e) {
      toast(toApiError(e).message, "error");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !files.length) return;
    const form = new FormData();
    form.append("body", body);
    files.forEach((f) => form.append("files", f));
    const message = await send.run(() => api<ChatMessage>(`/api/messages/conversations/${conversationId}/messages/`, { method: "POST", body: form }));
    if (message) {
      setMessages((m) => [...m, message]);
      setBody("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      activity.current();
      window.setTimeout(() => bottom.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }), 0);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const other = conversation?.other ?? null;
  const isGroup = conversation?.kind === "GROUP";
  const members = isGroup ? (conversation?.members ?? []) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-surface-container-high/40 px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1 text-on-surface-variant hover:bg-surface-container-high lg:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        {conversation && <ConversationAvatar c={conversation} size={36} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-primary">{conversation?.name || other?.full_name || "Conversation"}</h2>
          {isGroup ? (
            <p className="truncate text-xs text-on-surface-variant">{conversation?.members.map((m) => (m.user_id === meId ? "You" : m.full_name.split(" ")[0])).join(", ")}</p>
          ) : (
            other && <p className="truncate text-xs text-on-surface-variant">{personLine(other)}</p>
          )}
        </div>
        {isGroup && conversation && (
          <Button size="sm" variant="secondary" icon={<Groups className="h-4 w-4" />} onClick={() => setShowMembers(true)} aria-label={`${conversation.member_count} members`}>
            {conversation.member_count}
          </Button>
        )}
      </div>
      {isGroup && conversation && (
        <GroupMembersModal
          open={showMembers}
          conversation={conversation}
          meId={meId}
          onClose={() => setShowMembers(false)}
          onChanged={(c) => {
            setConversation(c);
            activity.current();
          }}
          onLeft={() => {
            setShowMembers(false);
            onLeft();
          }}
        />
      )}

      <div className="flex-1 space-y-3 overflow-y-auto bg-surface-container/60 px-4 py-4" aria-label="Messages" role="log">
        {hasMore && (
          <div className="text-center">
            <Button size="sm" variant="secondary" loading={loadingOlder} onClick={() => void loadOlder()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {!messages.length && <p className="py-10 text-center text-sm text-on-surface-variant">No messages yet. Say hello 👋</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex items-end gap-2 ${m.is_mine ? "justify-end" : "justify-start"}`}>
            {isGroup && !m.is_mine && <Avatar name={m.sender?.full_name ?? "?"} src={photoOf(m.sender)} size={28} />}
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2 text-sm sm:max-w-[70%] ${m.is_mine ? "bg-primary-container/15 text-primary ring-1 ring-inset ring-primary-container/25" : "bg-surface-container-high text-on-surface"}`}>
              {isGroup && !m.is_mine && <p className="mb-0.5 text-xs font-semibold text-info">{m.sender?.full_name ?? "Former member"}</p>}
              {m.body && <p className="whitespace-pre-wrap break-words"><LinkifiedText text={m.body} /></p>}
              {m.attachments.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a
                        href={a.download_url}
                        download={a.original_filename}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${m.is_mine ? "bg-black/30 hover:bg-black/50" : "bg-surface-container-highest hover:bg-surface-bright"}`}
                        aria-label={`Download ${a.original_filename}`}
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{a.original_filename}</span>
                        <span className="shrink-0 opacity-70">{fmtBytes(a.size)}</span>
                        <Download className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-outline">
                {fmtDateTime(m.created_at)}
                {m.is_mine && <ReceiptMark receipt={m.receipt} members={members} />}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={onSend} className="border-t border-surface-container-high/40 p-3">
        {send.error && (
          <div className="mb-2">
            <Alert>{send.error.fields.files?.join(" ") || send.error.fields.body?.join(" ") || send.error.message}</Alert>
          </div>
        )}
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-xs text-on-surface">
                <Paperclip className="h-3 w-3" /> {f.name} <span className="text-outline">{fmtBytes(f.size)}</span>
                <button type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="ml-1 text-on-surface-variant hover:text-primary">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-surface-container-high text-on-surface-variant hover:bg-surface-container" title="Attach files">
            <span className="sr-only">Attach files</span>
            <Paperclip className="h-4 w-4" />
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((all) => [...all, ...picked].slice(0, MAX_FILES));
                e.target.value = "";
              }}
            />
          </label>
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={5000}
              placeholder="Write a message…"
              className="block max-h-40 min-h-10 w-full resize-y rounded-lg border border-surface-container-high px-3 py-2 text-sm focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
            />
          </label>
          <Button type="submit" variant="dark" icon={<Send className="h-4 w-4" />} loading={send.pending} disabled={!body.trim() && !files.length}>
            Send
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-outline">PDF, Word, Excel, CSV, text and images · up to {MAX_FILES} files · Enter to send, Shift+Enter for a new line</p>
      </form>
    </div>
  );
}

function MessagesContent() {
  const { can, me } = useAuth();
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const activeId = Number(params.get("c")) || null;
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<ReturnType<typeof toApiError> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await api<{ results: Conversation[] }>("/api/messages/conversations/");
      setConversations(r.results);
      setListError(null);
    } catch (e) {
      setListError(toApiError(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useVisiblePolling(loadList, LIST_POLL_MS, true);

  const open = useCallback(
    (id: number | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false }),
    [pathname, router],
  );

  async function startWith(person: Person) {
    try {
      const c = await api<Conversation>("/api/messages/conversations/", { body: { user_id: person.user_id } });
      open(c.id);
    } catch (e) {
      toast(toApiError(e).message, "error");
    }
  }

  if (!can("messages.use") || !me) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Messages"
        description="Private conversations and groups. Only members can read them."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Create Group
          </Button>
        }
      />
      <CreateGroupModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          void loadList();
          open(c.id);
        }}
      />
      <Card className="overflow-hidden">
        <div className="grid h-[calc(100vh-14rem)] min-h-[28rem] lg:grid-cols-[20rem_1fr]">
          <aside className={`min-h-0 flex-col border-surface-container-high/40 lg:flex lg:border-r ${activeId ? "hidden" : "flex"}`}>
            <PeopleSearch onPick={(p) => void startWith(p)} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listError ? (
                <ErrorState error={listError} onRetry={() => void loadList()} />
              ) : conversations === null ? (
                <Loading />
              ) : (
                <ConversationList conversations={conversations} activeId={activeId} onOpen={open} />
              )}
            </div>
          </aside>
          <section className={`min-h-0 ${activeId ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}>
            {activeId ? (
              <Thread
                key={activeId}
                conversationId={activeId}
                meId={me.id}
                onBack={() => open(null)}
                onActivity={() => void loadList()}
                onLeft={() => {
                  open(null);
                  void loadList();
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="Select a conversation" description="Or find a colleague by @username, Employee ID or name, or create a group." />
              </div>
            )}
          </section>
        </div>
      </Card>
    </>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MessagesContent />
    </Suspense>
  );
}
