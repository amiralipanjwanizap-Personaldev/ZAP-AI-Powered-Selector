# ZAP Trend Curator

The real tool — upload photos, AI scores them, get a best single shot and
an ordered carousel, with trend-aware captions.

- `index.html` — the actual AI curation tool
- `api/anthropic-proxy.js` — holds your real Anthropic API key server-side
  and forwards requests to it; the browser never sees the key
- `api/health.js` — basic "is the backend alive" check
- `api/db-health.js` — Supabase connection check (not currently used by
  anything — login/credits/dashboard are paused for now, picking back up later)

## Required: one environment variable in Vercel
`ANTHROPIC_API_KEY` — get this from console.anthropic.com (separate account
and billing from Claude.ai). Add it in Vercel → Settings → Environment
Variables, then redeploy.

## Next steps (in order)
1. Confirm the tool works live with your real API key.
2. Come back to Supabase (login, credits, dashboard history) once this is solid.
3. Add the export/caption/trend-refresh polish back in if anything got simplified along the way.
