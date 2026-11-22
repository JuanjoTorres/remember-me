// A stand-in for api.stripe.com used by the end-to-end tests. It answers the three calls the API
// makes and "completes" Checkout instantly by sending the browser straight to the success URL.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4242);
const PRICES = { price_e2e_premium: 499, price_e2e_custom_slug: 199 };
const sessions = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const path = (req.url ?? '').split('?')[0];
    const json = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'GET' && path === '/__health') return json(200, { ok: true });
    // Test hook: the sessions created so far, newest last.
    if (req.method === 'GET' && path === '/__sessions') return json(200, sessions);

    const price = /^\/v1\/prices\/(\w+)$/.exec(path);
    if (req.method === 'GET' && price && PRICES[price[1]] !== undefined) {
      return json(200, {
        id: price[1],
        object: 'price',
        unit_amount: PRICES[price[1]],
        currency: 'eur',
      });
    }
    if (req.method === 'POST' && path === '/v1/checkout/sessions') {
      const form = new URLSearchParams(body);
      const session = {
        id: `cs_test_${randomUUID().replaceAll('-', '')}`,
        orderId: form.get('client_reference_id'),
        lineItems: [...form.keys()]
          .filter((key) => /^line_items\[\d+\]\[price\]$/.test(key))
          .map((key) => form.get(key)),
        hasPaymentMethodList: [...form.keys()].some((key) => key.includes('payment_method_types')),
      };
      sessions.push(session);
      return json(200, {
        id: session.id,
        object: 'checkout.session',
        url: form.get('success_url'),
      });
    }
    if (req.method === 'POST' && /^\/v1\/checkout\/sessions\/\w+\/expire$/.test(path)) {
      return json(200, { object: 'checkout.session', status: 'expired' });
    }
    json(404, {
      error: { type: 'invalid_request_error', message: `No route for ${req.method} ${path}` },
    });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Fake Stripe listening on ${PORT}`));
