// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers, mockFetch } from "@/test/utils";
import MessagesPage from "./page";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.replace }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const BOB = {
  user_id: 9, full_name: "Bob Builder", username: "bob", employee_id: 5, employee_code: "EMP-0005",
  designation: "Engineer", department: null, has_photo: false,
};
const CONVERSATION = {
  id: 12, other: BOB, unread_count: 2, last_message_at: "2026-10-02T10:00:00Z", created_at: "2026-10-02T09:00:00Z",
  last_message: { id: 3, body: "Are you there?", is_mine: false, attachment_count: 0, created_at: "2026-10-02T10:00:00Z" },
};
const MESSAGES = [
  { id: 2, conversation: 12, sender_id: 9, body: "Hi!", attachments: [], created_at: "2026-10-02T09:59:00Z", is_mine: false },
  {
    id: 3, conversation: 12, sender_id: 9, body: "Are you there?", created_at: "2026-10-02T10:00:00Z", is_mine: false,
    attachments: [{ id: 40, original_filename: "plan.pdf", content_type: "application/pdf", size: 2048, created_at: "2026-10-02T10:00:00Z", download_url: "/api/messages/attachments/40/download/" }],
  },
];

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Messages", () => {
  it("lists conversations with unread counts and finds people by @username", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/messages/conversations/") return { body: { results: [CONVERSATION] } };
      if (url.startsWith("/api/messages/people/")) return { body: { results: [BOB] } };
    });
    render(<Providers><MessagesPage /></Providers>);
    expect(await screen.findByText("Bob Builder")).toBeTruthy();
    expect(screen.getByLabelText("2 unread")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Find @username, Employee ID or name"), { target: { value: "@bob" } });
    // debounced search: allow for slow CI machines
    expect(await screen.findByRole("button", { name: "Message Bob Builder" }, { timeout: 5000 })).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/messages/people/?q=%40bob")).toBe(true);
  });

  it("opens a conversation, marks it read, shows downloadable files and sends a file", async () => {
    nav.search = "c=12";
    let sent: FormData | undefined;
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/messages/conversations/") return { body: { results: [CONVERSATION] } };
      if (url === "/api/messages/conversations/12/") return { body: CONVERSATION };
      if (url === "/api/messages/conversations/12/messages/" && init?.method === "POST") {
        sent = init.body as FormData;
        return {
          status: 201,
          body: { id: 4, conversation: 12, sender_id: 7, body: "Here it is", created_at: "2026-10-02T10:05:00Z", is_mine: true,
            attachments: [{ id: 41, original_filename: "report.csv", content_type: "text/csv", size: 12, created_at: "2026-10-02T10:05:00Z", download_url: "/api/messages/attachments/41/download/" }] },
        };
      }
      if (url.startsWith("/api/messages/conversations/12/messages/")) return { body: { results: MESSAGES, has_more: false } };
      if (url === "/api/messages/conversations/12/read/") return { body: { last_read_message_id: 3 } };
    });
    render(<Providers><MessagesPage /></Providers>);
    const download = await screen.findByRole("link", { name: "Download plan.pdf" });
    expect(download.getAttribute("href")).toBe("/api/messages/attachments/40/download/");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/messages/conversations/12/read/")).toBe(true));

    const file = new File(["name,days\nbob,2\n"], "report.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [file] } });
    expect(screen.getByRole("list", { name: "Files to send" }).textContent).toContain("report.csv");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Here it is" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("link", { name: "Download report.csv" })).toBeTruthy();
    expect(sent?.get("body")).toBe("Here it is");
    expect((sent?.getAll("files")[0] as File).name).toBe("report.csv");
  });
});
