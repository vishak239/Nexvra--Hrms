// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptMark } from "@/components/messages/ReceiptMark";
import type { GroupMember, MessageReceipt } from "@/lib/types";
import { ME, Providers, mockFetch } from "@/test/utils";
import MessagesPage from "./page";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.replace }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const person = (id: number, name: string, photo = false) => ({
  user_id: id, full_name: name, username: name.split(" ")[0].toLowerCase(), employee_id: id + 100, employee_code: `E-${id}`,
  designation: "Engineer", department: null, has_photo: photo, photo_version: photo ? "v1" : null,
});
const ASHA = person(21, "Asha Rao", true);
const RAVI = person(22, "Ravi Kumar");
const MEERA = person(23, "Meera Nair");
const MEMBERS: GroupMember[] = [
  { ...person(ME.id, "Demo Employee"), role: "OWNER" },
  { ...ASHA, role: "MEMBER" },
  { ...RAVI, role: "MEMBER" },
];
const GROUP = {
  id: 50, kind: "GROUP", name: "Project Atlas", other: null, members: MEMBERS, member_count: 3, my_role: "OWNER",
  unread_count: 0, last_message_at: "2026-10-06T05:00:00Z", created_at: "2026-10-06T04:00:00Z",
  last_message: { id: 9, body: "Kick-off at 10", is_mine: false, sender_name: "Asha", attachment_count: 0, created_at: "2026-10-06T05:00:00Z" },
};
const receipt = (status: MessageReceipt["status"], read: number, seenBy: number[] = []): MessageReceipt => ({
  status, recipient_count: 2, delivered_count: 2, read_count: read, seen_by: seenBy,
});

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Create group", () => {
  it("names the group, picks members with photos, reviews and opens it", async () => {
    let created: { name: string; user_ids: number[] } | undefined;
    mockFetch((url, init) => {
      if (url === "/api/messages/conversations/") return { body: { results: [] } };
      if (url.startsWith("/api/messages/people/")) return { body: { results: [ASHA, RAVI, MEERA] } };
      if (url === "/api/messages/groups/" && init?.method === "POST") {
        created = JSON.parse(String(init.body));
        return { status: 201, body: GROUP };
      }
    });
    render(<Providers><MessagesPage /></Providers>);
    fireEvent.click(await screen.findByRole("button", { name: "Create Group" }));
    const dialog = await screen.findByRole("dialog");
    const review = within(dialog).getByRole("button", { name: "Review" });
    expect((review as HTMLButtonElement).disabled).toBe(true); // needs a name and two colleagues
    fireEvent.change(within(dialog).getByLabelText(/Group name/), { target: { value: "Project Atlas" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Asha Rao", pressed: false }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Ravi Kumar", pressed: false }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Ravi Kumar" })); // the chip removes again
    expect(within(dialog).getByRole("button", { name: "Ravi Kumar" }).getAttribute("aria-pressed")).toBe("false");
    expect((within(dialog).getByRole("button", { name: "Review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ravi Kumar", pressed: false }));
    // photos appear in the picker
    expect(dialog.querySelector('img[src="/api/employees/121/photo/?v=v1"]')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    const reviewList = await within(dialog).findByTestId("group-review");
    expect(reviewList.textContent).toContain("Project Atlas");
    expect(reviewList.textContent).toContain("3 members including you");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create group" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/messages?c=50", { scroll: false }));
    expect(created).toEqual({ name: "Project Atlas", user_ids: [21, 22] });
  });
});

describe("group conversation", () => {
  it("shows the group, who wrote each message, and seen status on my messages", async () => {
    nav.search = "c=50";
    mockFetch((url) => {
      if (url === "/api/messages/conversations/") return { body: { results: [GROUP] } };
      if (url === "/api/messages/conversations/50/") return { body: GROUP };
      if (url.startsWith("/api/messages/conversations/50/messages/"))
        return {
          body: {
            has_more: false,
            results: [
              { id: 8, conversation: 50, sender_id: 21, sender: ASHA, body: "Kick-off at 10", attachments: [], created_at: "2026-10-06T04:30:00Z", is_mine: false, receipt: null },
              { id: 9, conversation: 50, sender_id: ME.id, sender: MEMBERS[0], body: "On it", attachments: [], created_at: "2026-10-06T07:30:00Z", is_mine: true, receipt: receipt("delivered", 1, [21]) },
            ],
          },
        };
      if (url === "/api/messages/conversations/50/read/") return { body: { last_read_message_id: 9 } };
      if (url === "/api/messages/conversations/50/receipts/") return { body: { receipts: {} } };
    });
    render(<Providers><MessagesPage /></Providers>);
    const log = await screen.findByRole("log", { name: "Messages" });
    expect(await within(log).findByText("Asha Rao")).toBeTruthy(); // sender name on group messages
    expect(log.textContent).toContain("06 Oct 2026, 1:00 PM"); // 07:30 UTC shown as IST, 12-hour
    const mark = within(log).getByTestId("receipt");
    expect(mark.getAttribute("data-status")).toBe("delivered");
    expect(mark.getAttribute("title")).toBe("Seen by 1 of 2: Asha Rao");
    expect(screen.getByRole("button", { name: "3 members" })).toBeTruthy();
  });
});

describe("ReceiptMark", () => {
  it.each([
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["seen", "Seen"],
  ] as const)("direct message %s", (status, label) => {
    render(<ReceiptMark receipt={{ ...receipt(status, status === "seen" ? 1 : 0), recipient_count: 1 }} />);
    const mark = screen.getByTestId("receipt");
    expect(mark.getAttribute("title")).toBe(label);
    // The Nexvra seen mark appears only once the message was seen.
    expect(mark.textContent?.includes("N")).toBe(status === "seen");
  });

  it("shows nothing on other people's messages", () => {
    const { container } = render(<ReceiptMark receipt={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows partial group progress until everyone has seen it", () => {
    render(<ReceiptMark receipt={receipt("delivered", 1, [21])} members={MEMBERS} />);
    expect(screen.getByTestId("receipt").textContent).toContain("1/2");
  });
});
