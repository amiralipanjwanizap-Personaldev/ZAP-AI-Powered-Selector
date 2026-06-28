# ZAP Trend Curator

Starting point for deployment. This is intentionally minimal — just enough
to prove GitHub → Vercel is wired up correctly before adding real features.

- `index.html` — landing page with a button that checks the backend
- `api/health.js` — a live serverless function at `/api/health`

## Next steps (in order)
1. Confirm this deploys on Vercel and the "Check backend connection" button works.
2. Add Supabase (database + login).
3. Move the AI scoring/caption logic into `/api`, connected to your own Anthropic API key.
4. Build out the real dashboard and tool pages.
