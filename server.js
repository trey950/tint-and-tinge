// Tint & Tinge — Express server.
//
// Flow:
//   1. Client SPA computes the season locally + collects email.
//   2. POST /api/checkout creates a Stripe Checkout session, embedding the
//      questionnaire answers + email in metadata.
//   3. Stripe redirects to checkout.stripe.com; on success, redirects to
//      /success?session_id=cs_xxx
//   4. Stripe also fires checkout.session.completed → POST /api/webhook
//      → we re-classify on the server (defense in depth), render the HTML
//      email, and send it via Resend.
//   5. /success page polls GET /api/order/:id until "ready", then shows the
//      full analysis inline using a small client-side classifier shim.

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
const stripe   = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// In-memory order ledger. For v1 this is fine — a $49 product with low
// volume. Upgrade to Postgres / Render KV when daily volume warrants it.
const orders = new Map();

// ---------------- Stripe webhook MUST get raw body before json parser ----------------
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
      const answers = JSON.parse(session.metadata.answers || "{}");
      const email = session.customer_details?.email || session.metadata.email;
      const name  = session.customer_details?.name  || session.metadata.name || "";
      const result = classify(answers);

      const order = {
        id: session.id,
        email,
        name,
        season: result.season,
        confidence: result.confidence,
        status: "ready",
        ref: `TNT-${new Date().getFullYear().toString().slice(-2)}-${Math.floor(Math.random()*90000+10000)}`,
        createdAt: new Date().toISOString(),
      };
      orders.set(session.id, order);

      await sendAnalysisEmail({
        to: email,
        name,
        result,
        orderRef: order.ref,
      });
      console.log("[webhook] sent analysis email to", email, "season:", result.season);
    } catch (e) {
      console.error("[webhook] processing failed:", e);
    }
  }
  res.json({ received: true });
});

// ---------------- standard middleware ----------------
app.use(express.json({ limit: "200kb" }));

// ---------------- routes ----------------
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Public config used by the SPA (Pixel ID, Stripe publishable key)
app.get("/api/config", (_req, res) => {
  res.json({
    metaPixelId: process.env.META_PIXEL_ID || "",
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    priceUSD: 49,
  });
});

// Create Stripe Checkout session
app.post("/api/checkout", async (req, res) => {
  if (!stripe || !PRICE_ID) {
    return res.status(503).json({ error: "Stripe not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID." });
  }
  const { email, name, answers } = req.body || {};
  if (!email || !answers) return res.status(400).json({ error: "Missing email or answers" });

  // basic validation: every required question answered
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
      payment_intent_data: {
        description: "Tint & Tinge Personal Color Analysis",
      },
      metadata: {
        email,
        name: name || "",
        answers: JSON.stringify(answers),
      },
      success_url: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/?canceled=1`,
    });
    res.json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("[checkout] failed:", e);
    res.status(500).json({ error: e.message });
  }
});

// Poll for order status on success page
app.get("/api/order/:id", (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.json({ status: "pending" });
  res.json({
    status: o.status,
    season: o.season,
    confidence: o.confidence,
    ref: o.ref,
    name: o.name,
  });
});

// ---------------- static + page routes ----------------
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
