import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { classify, QUESTIONS } from "./lib/classifier.js";
import { sendAnalysisEmail } from "./lib/email.js";

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

app.listen(PORT, () => {
  console.log(`Tint & Tinge listening on :${PORT}  (${APP_URL})`);
});
