const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

// Adjust these any time — just dollar amounts, nothing else to configure.
const PACKS = {
  small: { amountUsd: 5, label: 'ZAP credits — $5' },
  medium: { amountUsd: 20, label: 'ZAP credits — $20' },
  large: { amountUsd: 50, label: 'ZAP credits — $50' }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Server is missing the STRIPE_SECRET_KEY environment variable.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server is missing Supabase environment variables.' });
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  const { pack } = req.body || {};
  const selected = PACKS[pack];
  if (!selected) {
    return res.status(400).json({ error: 'Unknown credit pack.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: selected.label },
          unit_amount: Math.round(selected.amountUsd * 100)
        },
        quantity: 1
      }],
      // This is how the webhook knows which Supabase account to credit —
      // set in two places in case Stripe surfaces one but not the other
      // depending on event type.
      client_reference_id: userData.user.id,
      metadata: {
        supabase_user_id: userData.user.id,
        credit_amount_usd: String(selected.amountUsd)
      },
      success_url: `${origin}/?purchase=success`,
      cancel_url: `${origin}/?purchase=cancelled`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
