# Negative — long random-looking IDs that aren't secrets

- Stripe customer ID: `cus_O8abcdef1234567890` — not a key (lacks `sk_` prefix)
- Stripe price ID: `price_1HabcDEFghijKLMN` — not a key
- Session id: `sess_abcdef1234567890abcdef1234567890`
- Trace id: `trace-abcdef1234567890-0987654321fedcba`

None of these should trigger our patterns.
