// Wishlist HELISKYDIVE: salvează înscrierile și le arată echipei, după parolă.
// Parola NU stă aici (repo-ul e public): se setează în Netlify →
// Project configuration → Environment variables → ADMIN_KEY.
import { getStore } from "@netlify/blobs";

const FIELDS = [
  "lastName", "firstName", "email", "phone", "city",
  "funjump", "funjumpCount", "funjumpStay", "funjumpStayCount",
  "licence", "jumpsLogged",
  "tandem", "tandemStay", "companionFlight", "companionFlights",
  "companion", "companions", "event", "message", "consent",
];
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const store = getStore({ name: "wishlist", consistency: "strong" });

  if (body.action === "signup") {
    const src = body.entry || {};
    if (src.website) return json({ ok: true }); // capcană anti-spam
    const e = {};
    for (const k of FIELDS) e[k] = clean(src[k], k === "message" ? 1000 : 200);
    if (!e.lastName || !e.firstName || !e.email || !e.phone || !e.city) return json({ ok: false, error: "missing" }, 400);
    if (e.consent !== "da") return json({ ok: false, error: "consent" }, 400);
    e.createdAt = new Date().toISOString();
    e.source = "site";
    const id = `e/${e.createdAt}_${crypto.randomUUID().slice(0, 8)}`;
    await store.setJSON(id, e);
    return json({ ok: true });
  }

  const denied = await checkKey(store, body.key);
  if (denied) return json(denied, 401);

  if (body.action === "list") {
    const { blobs } = await store.list({ prefix: "e/" });
    const rows = (await Promise.all(blobs.map(async (b) => {
      const v = await store.get(b.key, { type: "json" });
      return v ? { id: b.key, ...v } : null;
    }))).filter(Boolean);
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json({ ok: true, rows });
  }

  if (body.action === "delete") {
    const id = String(body.id || "");
    if (!id.startsWith("e/")) return json({ ok: false, error: "bad_id" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
};

async function checkKey(store, key) {
  const real = (globalThis.Netlify?.env?.get("ADMIN_KEY")) ?? process.env.ADMIN_KEY;
  if (!real) return { ok: false, error: "not_configured" };
  const st = (await store.get("meta/fails", { type: "json" })) || { n: 0, until: 0 };
  if (Date.now() < st.until) return { ok: false, error: "locked" };
  if (String(key ?? "") !== real) {
    const n = st.n + 1;
    await store.setJSON("meta/fails", n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
    await new Promise((r) => setTimeout(r, 800));
    return { ok: false, error: "wrong_key" };
  }
  if (st.n) await store.setJSON("meta/fails", { n: 0, until: 0 });
  return null;
}

export const config = { path: "/api/wishlist" };
