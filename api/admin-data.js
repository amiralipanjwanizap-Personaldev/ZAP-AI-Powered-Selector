const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server is missing Supabase environment variables.' });
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Who is this?
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

  // 2. Are they actually an admin? Always checked server-side against the
  // database -- the client's own belief about its admin status is never
  // trusted, since that's exactly the kind of check a browser console can lie about.
  const { data: requesterPrefs, error: prefsError } = await supabaseAdmin
    .from('user_preferences')
    .select('is_admin')
    .eq('user_id', requesterId)
    .single();
  if (prefsError || !requesterPrefs || requesterPrefs.is_admin !== true) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    // 3. Pull every data source needed for the panel. This is a small
    // studio tool, not a platform with millions of rows, so pulling full
    // tables and aggregating in JS is simpler and plenty fast at this scale.
    // If job/transaction volume ever grows into the tens of thousands,
    // switch these to SQL-side aggregates (sum/count/group by) instead.
    const allAuthUsers = [];
    for (let page = 1; page <= 20; page++) {
      const { data: pageData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) throw new Error('Could not list users: ' + listError.message);
      allAuthUsers.push(...pageData.users);
      if (pageData.users.length < 200) break;
    }

    const [{ data: creditsRows, error: creditsErr }, { data: prefsRows, error: prefsErr },
      { data: txRows, error: txErr }, { data: jobRows, error: jobErr },
      { data: settingsRow, error: settingsErr }, { data: announcementRows, error: annErr }] = await Promise.all([
      supabaseAdmin.from('credits').select('user_id, balance_usd'),
      supabaseAdmin.from('user_preferences').select('user_id, is_admin'),
      supabaseAdmin.from('credit_transactions').select('*').order('created_at', { ascending: false }).limit(5000),
      supabaseAdmin.from('job_history').select('*').order('created_at', { ascending: false }).limit(10000),
      supabaseAdmin.from('app_settings').select('value').eq('key', 'service_multiplier').single(),
      supabaseAdmin.from('announcements').select('*').order('created_at', { ascending: false }).limit(20)
    ]);
    if (creditsErr) throw new Error('Could not load credits: ' + creditsErr.message);
    if (prefsErr) throw new Error('Could not load user_preferences: ' + prefsErr.message);
    if (txErr) throw new Error('Could not load credit_transactions: ' + txErr.message);
    if (jobErr) throw new Error('Could not load job_history: ' + jobErr.message);
    if (annErr) throw new Error('Could not load announcements: ' + annErr.message);

    const balanceByUser = new Map((creditsRows || []).map(r => [r.user_id, Number(r.balance_usd)]));
    const adminByUser = new Map((prefsRows || []).map(r => [r.user_id, !!r.is_admin]));

    // Per-user purchase totals + last activity, derived from the ledger.
    const purchaseTotalByUser = new Map();
    const purchaseCountByUser = new Map();
    const lastActivityByUser = new Map();
    const bumpLastActivity = (userId, ts) => {
      if (!ts) return;
      const cur = lastActivityByUser.get(userId);
      if (!cur || new Date(ts) > new Date(cur)) lastActivityByUser.set(userId, ts);
    };
    for (const tx of (txRows || [])) {
      bumpLastActivity(tx.user_id, tx.created_at);
      if (tx.type === 'purchase') {
        purchaseTotalByUser.set(tx.user_id, (purchaseTotalByUser.get(tx.user_id) || 0) + Number(tx.amount_usd));
        purchaseCountByUser.set(tx.user_id, (purchaseCountByUser.get(tx.user_id) || 0) + 1);
      }
    }

    // Per-user AI spend + sales report, split into "tracked" (has raw_cost_usd,
    // so real profit is computable) vs "untracked" (predates the column --
    // labeled honestly instead of guessed at).
    const chargedTotalByUser = new Map();
    const jobCountByUser = new Map();
    const sales = {
      tracked: { chargedUsd: 0, rawUsd: 0, jobCount: 0 },
      untracked: { chargedUsd: 0, jobCount: 0 },
      byJobType: {}
    };
    const ensureJobTypeBucket = (jt) => {
      if (!sales.byJobType[jt]) {
        sales.byJobType[jt] = {
          tracked: { chargedUsd: 0, rawUsd: 0, jobCount: 0 },
          untracked: { chargedUsd: 0, jobCount: 0 }
        };
      }
      return sales.byJobType[jt];
    };

    for (const job of (jobRows || [])) {
      bumpLastActivity(job.user_id, job.created_at);
      if (job.job_type === 'purchase') continue; // revenue, not AI spend -- tracked separately above

      const charged = Number(job.cost_usd) || 0;
      chargedTotalByUser.set(job.user_id, (chargedTotalByUser.get(job.user_id) || 0) + charged);
      jobCountByUser.set(job.user_id, (jobCountByUser.get(job.user_id) || 0) + 1);

      const bucket = ensureJobTypeBucket(job.job_type || 'unknown');
      if (job.raw_cost_usd === null || job.raw_cost_usd === undefined) {
        sales.untracked.chargedUsd += charged;
        sales.untracked.jobCount += 1;
        bucket.untracked.chargedUsd += charged;
        bucket.untracked.jobCount += 1;
      } else {
        const raw = Number(job.raw_cost_usd);
        sales.tracked.chargedUsd += charged;
        sales.tracked.rawUsd += raw;
        sales.tracked.jobCount += 1;
        bucket.tracked.chargedUsd += charged;
        bucket.tracked.rawUsd += raw;
        bucket.tracked.jobCount += 1;
      }
    }
    sales.tracked.profitUsd = sales.tracked.chargedUsd - sales.tracked.rawUsd;
    for (const jt of Object.keys(sales.byJobType)) {
      const b = sales.byJobType[jt];
      b.tracked.profitUsd = b.tracked.chargedUsd - b.tracked.rawUsd;
    }

    const users = allAuthUsers
      .map(u => ({
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        isAdmin: adminByUser.get(u.id) === true,
        balanceUsd: balanceByUser.has(u.id) ? balanceByUser.get(u.id) : null,
        totalPurchasedUsd: purchaseTotalByUser.get(u.id) || 0,
        purchaseCount: purchaseCountByUser.get(u.id) || 0,
        totalChargedUsd: chargedTotalByUser.get(u.id) || 0,
        jobCount: jobCountByUser.get(u.id) || 0,
        lastActivityAt: lastActivityByUser.get(u.id) || null
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const purchases = (txRows || [])
      .filter(tx => tx.type === 'purchase')
      .slice(0, 100)
      .map(tx => ({
        userId: tx.user_id,
        email: (allAuthUsers.find(u => u.id === tx.user_id) || {}).email || '(unknown)',
        amountUsd: Number(tx.amount_usd),
        description: tx.description,
        createdAt: tx.created_at
      }));

    const multiplier = (!settingsErr && settingsRow && settingsRow.value !== null)
      ? Number(settingsRow.value)
      : null;

    res.status(200).json({
      multiplier,
      users,
      sales,
      purchases,
      announcements: announcementRows || []
    });
  } catch (err) {
    console.error('admin-data failed:', err);
    res.status(500).json({ error: err.message });
  }
};
