const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stripe signs the EXACT raw bytes of the request body. Vercel's default
// body parser would have already converted it to a JS object by the time
// we see it, which breaks signature verification — so it's disabled here
// and the raw body is read manually instead.
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const signature = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // A failed signature check means this request did not genuinely come
    // from Stripe — reject it rather than trusting the payload.
    console.warn('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id);
    const amountUsd = (session.metadata && Number(session.metadata.credit_amount_usd))
      || (session.amount_total ? session.amount_total / 100 : null);

    if (userId && amountUsd) {
      const { error: addError } = await supabaseAdmin.rpc('add_credit', {
        p_user_id: userId,
        p_amount: amountUsd,
        p_description: `Stripe purchase (session ${session.id})`
      });
      if (addError) {
        console.error('Failed to add credit for session', session.id, addError);
        // Returning 500 here tells Stripe to retry the webhook later rather
        // than silently losing a paid-for credit grant.
        return res.status(500).json({ error: 'Failed to credit account.' });
      }
      await supabaseAdmin.from('job_history').insert({
        user_id: userId,
        job_type: 'purchase',
        summary: `Purchased $${amountUsd.toFixed(2)} in credits`,
        cost_usd: 0
      });
    } else {
      console.warn('Checkout session completed with no identifiable user/amount:', session.id);
    }
  }

  res.status(200).json({ received: true });
};
