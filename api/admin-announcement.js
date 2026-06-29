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

  const { action, message } = req.body || {};

  if (action === 'clear') {
    const { error } = await supabaseAdmin.from('announcements').update({ active: false }).eq('active', true);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'post') {
    const trimmed = (typeof message === 'string' ? message.trim() : '');
    if (!trimmed) {
      return res.status(400).json({ error: 'message is required.' });
    }
    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'message must be 500 characters or fewer.' });
    }
    // Only one announcement shows at a time -- deactivate any currently
    // active ones before inserting the new one, so the banner never has to
    // pick between several "active" rows.
    const { error: deactivateError } = await supabaseAdmin.from('announcements').update({ active: false }).eq('active', true);
    if (deactivateError) return res.status(500).json({ error: deactivateError.message });

    const { data, error: insertError } = await supabaseAdmin
      .from('announcements')
      .insert({ message: trimmed, active: true })
      .select('*')
      .single();
    if (insertError) return res.status(500).json({ error: insertError.message });
    return res.status(200).json({ announcement: data });
  }

  return res.status(400).json({ error: "action must be 'post' or 'clear'." });
};
