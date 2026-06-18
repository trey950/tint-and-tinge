# Tint & Tinge

Personal color analysis web app. Node + Express + Stripe + Resend, deployed on Render.

## Local development

```bash
nvm use 20          # or any Node 20+
npm install
cp .env.example .env   # fill in keys (see below)
npm run dev
# open http://localhost:3000
```

## Environment variables

See `.env.example`. All secrets are configured in the Render dashboard for production — do **not** commit `.env`.

| Variable | Where to get it | Required for |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | Checkout |
| `STRIPE_PUBLISHABLE_KEY` | Same | Future client-side use (not strictly required for Checkout redirect) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → reveal signing secret | Webhook verification |
| `STRIPE_PRICE_ID` | Stripe → Products → create a $49 one-time product, copy the price ID | Checkout |
| `RESEND_API_KEY` | Resend → API Keys | Sending analysis emails |
| `RESEND_FROM` | An address on a verified domain | Sending |
| `META_PIXEL_ID` | Meta Events Manager → Pixel | Ad tracking |
| `BUSINESS_ADDRESS` | Your registered business address | CAN-SPAM email footer |
| `APP_URL` | `https://tintandtinge.com` in production | Stripe success/cancel URLs |

## Routes

| Route | What it does |
|---|---|
| `GET /` | The SPA wizard |
| `GET /success` | Post-payment confirmation, polls `/api/order/:id` |
| `GET /cancel` | Redirects to `/?canceled=1` |
| `GET /privacy`, `/terms`, `/refund` | Legal pages |
| `GET /health` | Healthcheck for Render |
| `GET /api/config` | Public config (pixel ID, Stripe publishable key) |
| `POST /api/checkout` | Creates a Stripe Checkout session |
| `POST /api/webhook` | Stripe webhook handler — classifies + emails analysis |
| `GET /api/order/:id` | Order status poll |

## Going live — deployment checklist

### 1. GitHub
Create a new private repo, push this folder:
```bash
cd tint-and-tinge
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:<your-username>/tint-and-tinge.git
git push -u origin main
```

### 2. Stripe (one-time setup)
1. Create / activate a Stripe account for Tint and Tinge.
2. Products → Add product → "Personal Color Analysis" → one-time, $49 USD → copy the **price ID** (starts with `price_`).
3. Developers → API keys → copy the **secret key** (`sk_live_...`).
4. Developers → Webhooks → Add endpoint → URL `https://tintandtinge.com/api/webhook`, event `checkout.session.completed` → copy the **signing secret** (`whsec_...`).

### 3. Resend
1. Create a Resend account.
2. Domains → Add domain `tintandtinge.com` → Resend will show you DNS records (TXT, MX, CNAME).
3. API Keys → create one with "Sending access" scope → copy.

### 4. Render
1. New → Blueprint → connect your GitHub repo. Render will read `render.yaml` and create the service.
2. In the service's Environment tab, paste all the keys from steps 2–3. The blueprint marks them `sync: false` so you must paste them manually.
3. Deploy. The first build takes ~2 minutes.

### 5. Squarespace Domains (DNS)
Point `tintandtinge.com` at Render and verify Resend's sending domain.

**For Render** (open `tintandtinge.com` at your Render service URL):
- Add an `A` record: name `@`, value pointed at Render's load balancer IP (Render shows this in the service Settings → Custom Domains).
- Add a `CNAME`: name `www`, value `tint-and-tinge.onrender.com` (or whatever Render assigned).

**For Resend** (sending domain):
- Add the TXT, MX, and CNAME records Resend shows you. They look like:
  - `TXT` `_resend` → key string
  - `MX` `send` → priority 10, `feedback-smtp.us-east-1.amazonses.com`
  - `CNAME` `resend._domainkey` → DKIM key
- Click "Verify" in Resend after the records propagate (usually <30 min).

### 6. Add the domain in Render
In your Render service → Settings → Custom Domains → add `tintandtinge.com` and `www.tintandtinge.com`. Render will issue a free SSL cert via Let's Encrypt automatically.

### 7. Smoke test
1. Visit `https://tintandtinge.com` — should load the welcome page.
2. Walk through the wizard with real questionnaire answers + a real email you control.
3. At checkout, use a Stripe test card (`4242 4242 4242 4242`, any future date, any CVC, any ZIP) — **only works if you set `STRIPE_SECRET_KEY=sk_test_...`** during testing.
4. Confirm the analysis email lands.
5. Flip Stripe keys to live mode (`sk_live_...`), redeploy, test with a real $0.50 charge to yourself (refund after).

## Architecture notes

- **No database.** Orders are kept in an in-memory Map. Restarting the server loses pending orders. Fine for v1 at low volume; upgrade to Render KV or Postgres when daily volume warrants it.
- **PDF deliverable is stubbed.** `lib/pdf.js` is a placeholder. v1 ships the analysis as an HTML email (richer and more shareable than a PDF). Add Puppeteer + a server-rendered HTML template if you want PDFs in v2.
- **Photos never touch the server.** Client-side only. The privacy policy is honest about this.
- **Affiliate drip sequence:** add to `lib/email.js` later — e.g. a cron task or scheduled Resend send firing 3 days after `Order.createdAt` with affiliate jewelry links matched to `Order.season`.

## Things to add post-launch

- Order persistence (Render KV or Postgres)
- PDF attachment (Puppeteer)
- Affiliate jewelry email drip (Day 3, Day 7, Day 14)
- Gift cards / "for a friend" flow
- Re-analysis flow for returning customers
- Plausible or PostHog for product analytics
- A blog at `/journal` for SEO (Soft Autumn outfits, etc.)
