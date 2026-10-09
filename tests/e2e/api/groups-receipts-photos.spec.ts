import zlib from "node:zlib";
import { expect, test } from "@playwright/test";
import { json, login } from "../support/api";
import { freshEmployee, hrSession } from "../support/people";

/** A valid 1x1 PNG built at runtime (signature, IHDR, IDAT, IEND with real CRCs). */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from([0, 0x30, 0x60, 0x90]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const PNG = png();

test("group conversation: members read the history, receipts go sent -> delivered -> seen, outsiders get 404", async () => {
  const hr = await hrSession();
  const [a, b, c, outsider] = [
    await freshEmployee(hr, { firstName: "Gina" }),
    await freshEmployee(hr, { firstName: "Hari" }),
    await freshEmployee(hr, { firstName: "Indu" }),
    await freshEmployee(hr, { firstName: "Out" }),
  ];
  await hr.dispose();
  const alice = await login(a.email, a.password);
  const bob = await login(b.email, b.password);
  const carol = await login(c.email, c.password);
  const other = await login(outsider.email, outsider.password);

  const group = await json(await alice.post("/api/messages/groups/", { name: "E2E Atlas", user_ids: [b.userId, c.userId] }), 201);
  expect(group).toMatchObject({ kind: "GROUP", name: "E2E Atlas", member_count: 3, my_role: "OWNER" });
  const msg = await json(await alice.post(`/api/messages/conversations/${group.id}/messages/`, { body: "Kick-off at 10" }), 201);
  expect(msg.receipt).toMatchObject({ status: "sent", recipient_count: 2 });

  await json(await bob.get("/api/notifications/updates/"), 200); // Bob's app polls: delivered to Bob
  await json(await carol.get("/api/notifications/updates/"), 200);
  let receipts = (await json(await alice.get(`/api/messages/conversations/${group.id}/receipts/`), 200)).receipts;
  expect(receipts[String(msg.id)].status).toBe("delivered");

  for (const member of [bob, carol]) {
    const history = await json(await member.get(`/api/messages/conversations/${group.id}/messages/`), 200);
    expect(history.results.map((m: { body: string }) => m.body)).toEqual(["Kick-off at 10"]);
    await json(await member.post(`/api/messages/conversations/${group.id}/read/`), 200);
  }
  receipts = (await json(await alice.get(`/api/messages/conversations/${group.id}/receipts/`), 200)).receipts;
  expect(receipts[String(msg.id)]).toMatchObject({ status: "seen", read_count: 2 });

  expect((await other.get(`/api/messages/conversations/${group.id}/messages/`)).status()).toBe(404);
  expect((await other.get(`/api/messages/conversations/${group.id}/receipts/`)).status()).toBe(404);
  expect((await bob.post(`/api/messages/conversations/${group.id}/members/`, { user_ids: [outsider.userId] })).status()).toBe(403);
  await Promise.all([alice.dispose(), bob.dispose(), carol.dispose(), other.dispose()]);
});

test("a colleague sees an uploaded profile photo; the rest of the record stays private", async () => {
  const hr = await hrSession();
  const owner = await freshEmployee(hr, { firstName: "Photo" });
  const colleague = await freshEmployee(hr, { firstName: "Viewer" });
  await hr.dispose();
  const me = await login(owner.email, owner.password);
  const res = await me.postFile(`/api/employees/${owner.id}/photo/`, "photo", { name: "me.png", mimeType: "image/png", buffer: PNG });
  expect(res.status()).toBe(200);
  const version = (await res.json()).photo_version;
  const viewer = await login(colleague.email, colleague.password);
  const photo = await viewer.get(`/api/employees/${owner.id}/photo/`, { v: version });
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe("image/png");
  expect(photo.headers()["cache-control"]).toContain("private");
  expect((await viewer.get(`/api/employees/${owner.id}/`)).status()).toBe(404);
  await Promise.all([me.dispose(), viewer.dispose()]);
});
