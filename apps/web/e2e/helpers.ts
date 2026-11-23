import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { WEBHOOK_SECRET } from '../playwright.config';

const API = 'http://localhost:4000';
const FAKE_STRIPE = 'http://127.0.0.1:4242';

export interface FakeSession {
  id: string;
  orderId: string;
  lineItems: string[];
  hasPaymentMethodList: boolean;
}

/** The Checkout session the API created most recently on the Stripe stand-in. */
export async function lastCheckoutSession(): Promise<FakeSession> {
  const sessions = (await (await fetch(`${FAKE_STRIPE}/__sessions`)).json()) as FakeSession[];
  const last = sessions.at(-1);
  if (!last) throw new Error('No checkout session was created');
  return last;
}

/** Delivers a `checkout.session.completed` webhook, signed the way Stripe signs it. */
export async function deliverPaidWebhook(
  session: FakeSession,
  amountTotal: number,
): Promise<number> {
  const payload = JSON.stringify({
    id: `evt_e2e_${session.id}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: session.id,
        object: 'checkout.session',
        payment_status: 'paid',
        amount_total: amountTotal,
        currency: 'eur',
        client_reference_id: session.orderId,
        metadata: { orderId: session.orderId },
      },
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const response = await fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
  return response.status;
}

export async function startGift(page: Page, recipient: string): Promise<void> {
  await page.goto('/create');
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Build the story' })).toBeVisible();
  await page.getByRole('textbox', { name: 'For' }).fill(recipient);
  await page.getByRole('textbox', { name: 'From' }).fill('Juan');
  await page.getByRole('heading', { name: 'The story', exact: true }).click();
}

export async function addTextCard(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: '+ Photo & text' }).click();
  const sheet = page.getByRole('dialog', { name: 'Photo & text' });
  await sheet.getByRole('textbox', { name: /Text/ }).fill(text);
  await sheet.getByRole('button', { name: 'Add card' }).click();
  await expect(sheet).toBeHidden();
}

export async function fillSurprise(page: Page, headline: string): Promise<void> {
  await page.getByRole('textbox', { name: /^The surprise/ }).fill(headline);
  await page.getByRole('textbox', { name: /^Message/ }).fill('Pack light.');
  await page.getByRole('heading', { name: 'The surprise', exact: true }).click();
}

/** Collects the JavaScript a page downloads, to check what a route ships to the browser. */
export function recordScripts(page: Page): () => Promise<string> {
  const bodies: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script')
      bodies.push(response.text().catch(() => ''));
  });
  return async () => (await Promise.all(bodies)).join('\n');
}
