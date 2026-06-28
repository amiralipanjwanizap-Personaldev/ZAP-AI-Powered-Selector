// Proves the Supabase connection works, without needing any tables to
// exist yet. Hitting the REST API's root endpoint with just the URL and
// anon key returns 200 if (and only if) both are valid and Supabase is
// reachable — same idea as api/health.js, one level deeper.
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
      headers: { apikey: key }
    });
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: `Supabase responded with status ${response.status}` });
    }
    res.status(200).json({ ok: true, message: 'Supabase is reachable', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
