const { createClient } = require('@supabase/supabase-js');

// Same verified pricing as the cost estimator already built and tested.
const PRICE_INPUT_PER_MTOK = 3.0;
const PRICE_OUTPUT_PER_MTOK = 15.0;
const PRICE_PER_SEARCH = 0.01;
// Fallback only — used if app_settings can't be read for any reason, so a
// transient settings-table hiccup degrades to "charge the old rate" rather
// than breaking every AI action in the app.
const FALLBACK_SERVICE_MULTIPLIER = 1.10;

// The real multiplier now lives in app_settings (key='service_multiplier'),
// editable live from the admin panel without a redeploy. supabaseAdmin uses
// the service_role key, so this read bypasses RLS regardless of who's logged in.
async function getServiceMultiplier(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'service_multiplier')
    .single();
  if (error || !data || data.value === null || data.value === undefined) {
    console.warn('Could not read service_multiplier from app_settings, using fallback:', error && error.message);
    return FALLBACK_SERVICE_MULTIPLIER;
  }
  const parsed = Number(data.value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn('service_multiplier in app_settings is not a valid positive number, using fallback:', data.value);
    return FALLBACK_SERVICE_MULTIPLIER;
  }
  return parsed;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server is missing Supabase environment variables.' });
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Who is this? Verify their session token against Supabase Auth.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  const userId = userData.user.id;

  // 2. Do they have any balance at all? (Exact cost isn't known until after
  // the call — Anthropic's response tells us actual tokens used — so this
  // is a simple "not already out of credit" gate, not a precise pre-charge.)
  const { data: creditsRow, error: creditsError } = await supabaseAdmin
    .from('credits')
    .select('balance_usd')
    .eq('user_id', userId)
    .single();

  if (creditsError || !creditsRow) {
    return res.status(402).json({ error: 'No credit balance found for this account.' });
  }
  if (Number(creditsRow.balance_usd) <= 0) {
    return res.status(402).json({ error: 'Insufficient credit balance. Please add credits to continue.' });
  }

  // 3. Pull off our own metadata before forwarding the rest to Anthropic —
  // Anthropic's API shouldn't see fields it doesn't recognize.
  const { zap_meta, ...anthropicBody } = req.body || {};
  const jobType = (zap_meta && zap_meta.job_type) || 'unknown';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing the ANTHROPIC_API_KEY environment variable.' });
  }

  let anthropicResponse, data, serviceMultiplier;
  try {
    [anthropicResponse, serviceMultiplier] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(anthropicBody)
      }),
      getServiceMultiplier(supabaseAdmin)
    ]);
    data = await anthropicResponse.json();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // 4. Charge for what actually happened, using Anthropic's real usage
  // numbers from the response — not our pre-flight estimate. This now
  // includes the per-search server-tool fee (Anthropic bills $0.01/search
  // separately from tokens), reported in usage.server_tool_use.web_search_requests.
  let newBalance = creditsRow.balance_usd;
  if (data.usage) {
    const inputTokens = data.usage.input_tokens || 0;
    const outputTokens = data.usage.output_tokens || 0;
    const webSearches = (data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    const rawCost = (inputTokens * PRICE_INPUT_PER_MTOK + outputTokens * PRICE_OUTPUT_PER_MTOK) / 1e6
      + (webSearches * PRICE_PER_SEARCH);
    const cost = rawCost * serviceMultiplier;
    const summary = webSearches > 0
      ? `${inputTokens} in / ${outputTokens} out tokens, ${webSearches} search(es)`
      : `${inputTokens} in / ${outputTokens} out tokens`;

    const { data: deductResult, error: deductError } = await supabaseAdmin.rpc('deduct_credit', {
      p_user_id: userId,
      p_amount: cost,
      p_type: jobType,
      p_description: summary
    });
    if (!deductError) newBalance = deductResult;

    // raw_cost_usd is the real Anthropic cost before markup; cost_usd is what
    // the user was actually charged. Keeping both is what makes profit
    // computable later without guessing.
    await supabaseAdmin.from('job_history').insert({
      user_id: userId,
      job_type: jobType,
      summary: summary,
      cost_usd: cost,
      raw_cost_usd: rawCost
    });
  }

  res.status(anthropicResponse.status).json({ ...data, zap_new_balance: newBalance });
};
