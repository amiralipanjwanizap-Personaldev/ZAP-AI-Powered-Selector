// Proves the Supabase connection works, without needing any tables to
// exist yet. Sends the key in both the apikey header and as an
// Authorization Bearer token — Supabase's gateway sometimes expects both,
// and sending the same value in both is always safe.
module.exports = async (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return res.status(500).json({
      ok: false,
      error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables in Vercel.'
    });
  }

  try {
    const response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({
        ok: false,
        error: `Supabase responded with status ${response.status}`,
        detail: body.slice(0, 300)
      });
    }
    res.status(200).json({ ok: true, message: 'Supabase is reachable', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
