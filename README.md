# ZAP Trend Curator

AI-assisted photo selection and trend-aware captioning for wedding
photographers. Upload a gallery, get a best single shot and an ordered
carousel, with captions checked against current trends.

## Pages
- `index.html` — public landing page (no login required)
- `app.html` — the actual tool: login/signup, balance, the AI curation tool itself

## Backend
- `api/anthropic-proxy.js` — holds the real Anthropic API key server-side,
  checks/deducts real credit balance, forwards requests
- `api/create-checkout-session.js` — starts a Stripe Checkout session for buying credits
- `api/stripe-webhook.js` — Stripe calls this on successful payment; this is
  the only place credits actually get added
- `api/health.js` — basic "is the backend alive" check
- `api/db-health.js` — Supabase connection check (diagnostic only, not used by the app)

## Required environment variables (set in Vercel → Settings → Environment Variables)
- `ANTHROPIC_API_KEY` — from console.anthropic.com (separate account/billing from Claude.ai)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Project Settings → API
- `STRIPE_SECRET_KEY` — from Stripe → Developers → API keys
- `STRIPE_WEBHOOK_SECRET` — from the webhook endpoint's "Signing secret" in Stripe

`SUPABASE_URL` and the anon/publishable key are also pasted directly into
`app.html` (safe to expose client-side by design) — search for `PASTE_YOUR`
in that file.

## Database
Run `supabase-schema.sql` once in Supabase's SQL Editor for the credits,
transaction ledger, and job history tables, plus the auto-starting-balance
trigger. The `add_credit` and `deduct_credit` functions were added afterward
directly via migration.

## Status
Core loop is fully working: signup, free starter credit, real AI usage
billed and logged, Stripe top-ups, landing page in front of it all.
Remaining open items: Terms of Service / Privacy Policy, abuse prevention
for repeat free-credit signups, and switching Stripe from test to live mode.
