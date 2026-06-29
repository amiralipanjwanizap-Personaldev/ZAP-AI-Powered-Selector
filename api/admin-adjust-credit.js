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

  // Admin check is always server-side, against the database -- never trust
  // whatever the calling page claims about its own admin status.
  const { data: requesterPrefs, error: prefsError } = await supabaseAdmin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', requesterId)
    .single();
  if (prefsError || !requesterPrefs || requesterPrefs.is_admin !== true) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { target_user_id, amount, description } = req.body || {};
  if (typeof target_user_id !== 'string' || !target_user_id.trim()) {
    return res.status(400).json({ error: 'target_user_id is required.' });
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero number (positive to add, negative to subtract).' });
  }
  // A sanity ceiling -- this is a manual override tool for real customer
  // support cases, not a place a typo should be able to move $100k.
  if (Math.abs(parsedAmount) > 1000) {
    return res.status(400).json({ error: 'amount must be between -1000 and 1000. For larger adjustments, do it directly in Supabase.' });
  }
  const trimmedDescription = (typeof description === 'string' ? description.trim() : '');
  if (!trimmedDescription) {
    return res.status(400).json({ error: 'A description is required so this shows up clearly in the user\'s activity log.' });
  }

  const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('admin_adjust_credit', {
    p_user_id: target_user_id,
    p_amount: parsedAmount,
    p_description: trimmedDescription
  });

  if (rpcError) {
    return res.status(500).json({ error: rpcError.message });
  }
  if (newBalance === null || newBalance === undefined) {
    // The function ran but UPDATE matched no row -- that user has no credits row.
    return res.status(404).json({ error: 'No credits row found for that user. They may not have a fully set-up account.' });
  }

  res.status(200).json({ new_balance: newBalance });
};
