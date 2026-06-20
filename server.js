import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";
import Stripe from "stripe";
import { classify, QUESTIONS } from "./lib/classifier.js";
import { sendAnalysisEmail, sendAbandonedCheckoutEmail } from "./lib/email.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
const PORT     = process.env.PORT || 3000;
const APP_URL  = process.env.APP_URL || `http://localhost:${PORT}`;
const stripe   = (process.env.STRIPE_SECRET_KEY||"").startsWith("sk_") ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const orders = new Map();
const pendingCheckouts = new Map();

// ---- Lightweight persistence (best-effort) ----
// Survives the process lifetime; survives restarts too when DATA_DIR points at a
// persistent disk (set DATA_DIR in Render and attach a disk on a paid plan).
const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
function loadStore() {
  try {
    const d = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (Array.isArray(d.orders))  for (const [k,v] of d.orders)  orders.set(k,v);
    if (Array.isArray(d.pending)) for (const [k,v] of d.pending) pendingCheckouts.set(k,v);
    console.log(`[store] loaded ${orders.size} orders, ${pendingCheckouts.size} pending checkouts`);
  } catch (_) { /* first boot / no file */ }
}
let _saveTimer = null;
function saveStore() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify({ orders: [...orders], pending: [...pendingCheckouts] }));
    } catch (e) { console.warn("[store] save failed:", e.message); }
  }, 500);
}
loadStore();

// ---- Meta Conversions API (server-side Purchase) ----
const META_PIXEL_ID   = process.env.META_PIXEL_ID   || "";
const META_CAPI_TOKEN = process.env.META_CAPI_TOKEN || "";
function sha256(v) { return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex"); }
async function sendMetaPurchaseEvent(session, order) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return;            // no-op until configured
  const email = (order && order.email) || session.customer_details?.email || "";
  const payload = { data: [{
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: session.id,                  // dedup with the browser pixel (eventID = Stripe session id)
    action_source: "website",
    event_source_url: `${APP_URL}/success`,
    user_data: email ? { em: [sha256(email)] } : {},
    custom_data: { currency: "USD", value: 49.00, content_name: "Personal Color Analysis" },
  }] };
  try {
    const r = await fetch(`https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!r.ok) console.warn("[capi] Purchase rejected:", r.status, await r.text());
    else console.log("[capi] Purchase sent for", session.id);
  } catch (e) { console.warn("[capi] send failed:", e.message); }
}

// ---- Abandoned-checkout reminder config ----
const REMINDER_AFTER_MS   = 60 * 60 * 1000;        // remind ~1 hour after starting checkout
const REMINDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // never remind on checkouts older than 24h

function buildOrderFromSession(session) {
  let answers = {};
  try { answers = JSON.parse(session.metadata?.answers || "{}"); } catch (_) {}
  const email = session.customer_details?.email || session.metadata?.email || "";
  const name  = session.customer_details?.name  || session.metadata?.name  || "";
  const result = Object.keys(answers).length ? classify(answers) : null;
  return {
    id: session.id,
    email,
    name,
    answers,
    season: result?.season || null,
    confidence: result?.confidence || null,
    result,
    status: result ? "ready" : "pending",
    ref: `TNT-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(Math.random()*90000+10000)}`,
    createdAt: new Date().toISOString(),
  };
}

app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) {
    console.warn("[webhook] Stripe not configured");
    return res.status(200).send("ok");
  }
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error("[webhook] signature verification failed:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      const order = buildOrderFromSession(session);
      orders.set(session.id, order);
      const pc = pendingCheckouts.get(session.id);
      if (pc) pc.purchased = true;
      saveStore();
      await sendMetaPurchaseEvent(session, order);
      if (order.email && order.result) {
        await sendAnalysisEmail({
          to: order.email,
          name: order.name,
          result: order.result,
          orderRef: order.ref,
        });
        console.log("[webhook] sent analysis email to", order.email, "season:", order.season);
      }
    } catch (e) {
      console.error("[webhook] processing failed:", e);
    }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "200kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/api/config", (_req, res) => {
  res.json({
    metaPixelId: process.env.META_PIXEL_ID || "",
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    priceUSD: 49,
  });
});

app.post("/api/checkout", async (req, res) => {
  if (!stripe || !PRICE_ID) {
    return res.status(503).json({ error: "Stripe not configured." });
  }
  const { email, name, answers } = req.body || {};
  if (!email || !answers) return res.status(400).json({ error: "Missing email or answers" });
  for (const q of QUESTIONS) {
    if (answers[q.id] === undefined || answers[q.id] === null) {
      return res.status(400).json({ error: `Missing answer for ${q.id}` });
    }
  }
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      customer_email: email,
      payment_intent_data: { description: "Tint & Tinge Personal Color Analysis" },
      metadata: { email, name: name || "", answers: JSON.stringify(answers) },
      success_url: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/?canceled=1`,
    });
    pendingCheckouts.set(session.id, { id: session.id, email, name, answers, createdAt: Date.now(), reminded: false, purchased: false });
    saveStore();
    res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("[checkout] failed:", e);
    res.status(500).json({ error: e.message });
  }
});

async function lookupOrder(sessionId) {
  if (orders.has(sessionId)) return orders.get(sessionId);
  if (!stripe || !sessionId?.startsWith("cs_")) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return null;
    const order = buildOrderFromSession(session);
    orders.set(sessionId, order);
    return order;
  } catch (e) {
    console.warn("[lookupOrder] stripe retrieve failed:", e.message);
    return null;
  }
}

app.get("/api/order/:id", async (req, res) => {
  const o = await lookupOrder(req.params.id);
  if (!o) return res.json({ status: "pending" });
  res.json({
    status: o.status,
    season: o.season,
    confidence: o.confidence,
    ref: o.ref,
    name: o.name,
    data: (o.result && o.result.data) || null,
  });
});

app.post("/api/resend", async (req, res) => {
  const { sessionId } = req.body || {};
  const o = await lookupOrder(sessionId);
  if (!o || !o.email || !o.result) return res.status(404).json({ error: "Order not found" });
  try {
    await sendAnalysisEmail({ to: o.email, name: o.name, result: o.result, orderRef: o.ref });
    res.json({ ok: true });
  } catch (e) {
    console.error("[resend] failed:", e);
    res.status(500).json({ error: e.message });
  }
});

if (process.env.SENTRY_DSN) {
  console.log("[sentry] DSN present; full SDK integration TODO");
}

const PUBLIC = path.join(__dirname, "public");
app.use(express.static(PUBLIC, { extensions: ["html"] }));
app.get(["/", "/index.html"],    (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.get("/success",              (_req, res) => res.sendFile(path.join(PUBLIC, "success.html")));
app.get("/cancel",               (_req, res) => res.sendFile(path.join(PUBLIC, "cancel.html")));
app.get(["/privacy","/privacy.html"], (_req, res) => res.sendFile(path.join(PUBLIC, "pages/privacy.html")));
app.get(["/terms","/terms.html"],     (_req, res) => res.sendFile(path.join(PUBLIC, "pages/terms.html")));
app.get(["/refund","/refund.html"],   (_req, res) => res.sendFile(path.join(PUBLIC, "pages/refund.html")));
app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC, "index.html")));

async function sweepAbandonedCheckouts() {
  const now = Date.now();
  for (const pc of pendingCheckouts.values()) {
    if (pc.purchased || pc.reminded || !pc.email) continue;
    const age = now - pc.createdAt;
    if (age < REMINDER_AFTER_MS || age > REMINDER_MAX_AGE_MS) continue;
    // Safety: confirm with Stripe the session wasn't actually paid before nudging.
    if (stripe) {
      try {
        const sess = await stripe.checkout.sessions.retrieve(pc.id);
        if (sess.payment_status === "paid") { pc.purchased = true; continue; }
      } catch (_) { /* ignore, proceed to remind */ }
    }
    try {
      await sendAbandonedCheckoutEmail({ to: pc.email, name: pc.name });
      pc.reminded = true;
      console.log("[abandon] reminder sent to", pc.email);
    } catch (e) { console.warn("[abandon] reminder failed:", e.message); }
  }
  saveStore();
}
setInterval(() => { sweepAbandonedCheckouts().catch(e => console.warn("[abandon] sweep error:", e.message)); }, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Tint & Tinge listening on :${PORT}  (${APP_URL})`);
});
