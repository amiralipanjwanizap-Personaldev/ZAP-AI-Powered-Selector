const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server is missing Supabase environment variables.' });
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  const requesterId = userData.user.id;

  const { data: requesterPrefs, error: prefsError } = await supabaseAdmin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', requesterId)
    .single();
  if (prefsError || !requesterPrefs || requesterPrefs.is_admin !== true) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { multiplier } = req.body || {};
  const parsed = Number(multiplier);
  // Bounded between 1.0 (no markup) and 5.0 (5x raw cost) -- wide enough for
  // real pricing changes, narrow enough that a typo can't silently 10x or
  // zero-out what every customer is charged.
  if (!Number.isFinite(parsed) || parsed < 1.0 || parsed > 5.0) {
    return res.status(400).json({ error: 'multiplier must be a number between 1.0 and 5.0.' });
  }

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .update({ value: parsed, updated_at: new Date().toISOString() })
    .eq('key', 'service_multiplier')
    .select('value')
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  res.status(200).json({ multiplier: Number(data.value) });
};
