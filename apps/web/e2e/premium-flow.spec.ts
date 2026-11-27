import { devices, expect, test } from '@playwright/test';
import {
  addTextCard,
  deliverPaidWebhook,
  fillSurprise,
  lastCheckoutSession,
  openPreview,
  startGift,
} from './helpers';

test('a creator uses PRO features for free, pays once to publish with a custom link, and the recipient scratches the surprise', async ({
  page,
}) => {
  const upgrade = page.getByRole('dialog', { name: 'The full experience' });
  await startGift(page, 'Marta');
  await addTextCard(page, 'Do you remember?');

  // A trivia and the scratch card, on a free draft, without paying anything yet
  await page.getByRole('button', { name: '+ Trivia' }).click();
  const trivia = page.getByRole('dialog', { name: 'Trivia question' });
  await trivia.getByRole('textbox', { name: 'Question' }).fill('Where did we meet?');
  await trivia.getByRole('textbox', { name: 'Answer 1' }).fill('Lisbon');
  await trivia.getByRole('textbox', { name: 'Answer 2' }).fill('Porto');
  await trivia.getByRole('radio', { name: 'Answer 2 is the correct one' }).check();
  await trivia.getByRole('button', { name: 'Add card' }).click();
  await expect(trivia).toBeHidden();
  await page.getByRole('button', { name: /Scratch card/ }).click();
  await expect(page.getByRole('button', { name: /Scratch card/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(upgrade).toBeHidden();
  await expect(page.getByTestId('pro-summary')).toContainText('Trivia · Premium reveal');
  await fillSurprise(page, 'Weekend in Porto!');

  // The preview plays the PRO features too
  await openPreview(page);
  await expect(page.getByRole('heading', { name: 'For Marta' })).toBeVisible();
  await expect(page.getByTestId('publish-note')).toContainText('PRO: Trivia · Premium reveal');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Where did we meet?')).toBeVisible();

  // Publishing is where it is paid for: the sheet opens with the prices from the API
  await page.getByRole('button', { name: 'Publish and get QR' }).click();
  await expect(upgrade.getByText(/uses PRO features\. One payment publishes it/)).toBeVisible();
  await expect(upgrade.getByText('An eternal memory: it never expires')).toBeVisible();
  await expect(upgrade.getByRole('button', { name: 'Pay €4.99' })).toBeVisible();
  await expect(page).toHaveURL(/\/preview$/);
  await upgrade.getByRole('checkbox').check();
  // The creator only chooses the name; the code in front is added by the server on payment
  const preview = upgrade.getByTestId('slug-preview');
  await expect(preview).toHaveText('localhost:3000/····/for/marta');
  await upgrade.getByRole('textbox', { name: 'Custom link' }).fill('te-quiero-marta');
  await expect(preview).toHaveText('localhost:3000/····/for/te-quiero-marta');
  await upgrade.getByRole('button', { name: 'Pay €6.98' }).click();

  // "Stripe" sends the customer back before the webhook arrives: the page waits
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}\/success$/);
  await expect(page.getByRole('heading', { name: 'Confirming your payment…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download QR' })).toHaveCount(0);

  const session = await lastCheckoutSession();
  expect(session.lineItems).toEqual(['price_e2e_premium', 'price_e2e_custom_slug']);
  expect(session.hasPaymentMethodList).toBe(false);

  // A forged webhook changes nothing; the real one confirms the payment
  const forged = await fetch('http://localhost:4000/payments/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' },
    body: '{}',
  });
  expect(forged.status).toBe(401);
  await page.waitForTimeout(2500);
  await expect(page.getByRole('heading', { name: 'Confirming your payment…' })).toBeVisible();

  expect(await deliverPaidWebhook(session, 698)).toBe(200);
  expect(await deliverPaidWebhook(session, 698)).toBe(200);

  await expect(page.getByRole('heading', { name: 'Your gift has everything' })).toBeVisible();
  await expect(page.getByText('It is published without watermark.')).toBeVisible();
  // The link has the name that was bought, behind a code nobody chose
  const link = page.getByRole('link', {
    name: /^localhost:3000\/[a-z0-9]{4}\/for\/te-quiero-marta$/,
  });
  await expect(link).toBeVisible();
  // The stored link is the path of the address: "7k2m/for/te-quiero-marta".
  const slug = ((await link.textContent()) ?? '').replace('localhost:3000/', '');
  expect(slug).toMatch(/[0-9]/);
  await expect(page.getByRole('img', { name: 'QR code of your gift' })).toBeVisible();

  // Final QR code in both formats
  for (const [button, extension] of [
    ['Download QR', 'png'],
    ['SVG', 'svg'],
  ] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    expect((await download).suggestedFilename()).toBe(
      `remember-me-${slug.replaceAll('/', '-')}.${extension}`,
    );
  }

  // Back in the editor it is the full experience, with the name fixed
  await page.getByRole('link', { name: 'Back to the editor' }).click();
  await expect(page.getByText('Full experience')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^For/ })).toBeDisabled();
  await expect(page.getByTestId('pro-summary')).toHaveCount(0);

  // --- The recipient ---
  const recipient = await page
    .context()
    .browser()!
    .newContext({ ...devices['Pixel 7'] });
  const phone = await recipient.newPage();
  await phone.goto(`/${slug}`, { waitUntil: 'networkidle' });
  await expect(phone.getByRole('heading', { name: 'For Marta' })).toBeVisible();
  await phone.getByRole('button', { name: 'Next' }).click();
  await expect(phone.getByText('Do you remember?')).toBeVisible();
  await phone.getByRole('button', { name: 'Next' }).click();

  // Trivia: a wrong answer does not let them through
  await expect(phone.getByText('Where did we meet?')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Next' })).toBeDisabled();
  await phone.getByRole('button', { name: 'Lisbon' }).click();
  await expect(phone.getByText('Not quite. Try again.')).toBeVisible();
  await phone.getByRole('button', { name: 'Porto' }).click();
  await phone.getByRole('button', { name: /Continue/ }).click();

  // Scratch with a finger until the surprise is uncovered
  const surface = phone.getByTestId('scratch-surface');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveCSS('opacity', '1');
  const box = (await surface.boundingBox())!;
  const client = await phone.context().newCDPSession(phone);
  const touch = (type: string, x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
  for (let row = 0; row < 8; row += 1) {
    const y = box.y + 14 + (row * (box.height - 28)) / 7;
    await touch('touchStart', box.x + 6, y);
    for (let step = 1; step <= 12; step += 1)
      await touch('touchMove', box.x + 6 + (step * (box.width - 12)) / 12, y);
    await touch('touchEnd', 0, 0);
    if ((await surface.evaluate((element) => getComputedStyle(element).opacity)) !== '1') break;
  }
  await expect(surface).toHaveCSS('opacity', '0');
  await expect(phone.getByText('Weekend in Porto!')).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Watch again' })).toBeVisible();
  // Premium: no watermark
  await expect(phone.getByTestId('watermark')).toHaveCount(0);
  await recipient.close();

  // The scratch card also works with a mouse
  const desktop = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 1280, height: 800 } });
  const laptop = await desktop.newPage();
  // Keyboard navigation only exists once the page is interactive.
  await laptop.goto(`/${slug}`, { waitUntil: 'networkidle' });
  await expect(laptop.getByRole('heading', { name: 'For Marta' })).toBeVisible();
  await laptop.keyboard.press('ArrowRight');
  await expect(laptop.getByText('Do you remember?')).toBeVisible();
  await laptop.keyboard.press('ArrowRight');
  await laptop.getByRole('button', { name: 'Porto' }).click();
  await laptop.getByRole('button', { name: /Continue/ }).click();
  const canvas = laptop.getByTestId('scratch-surface');
  await expect(canvas).toHaveCSS('opacity', '1');
  const area = (await canvas.boundingBox())!;
  for (let row = 0; row < 8; row += 1) {
    const y = area.y + 14 + (row * (area.height - 28)) / 7;
    await laptop.mouse.move(area.x + 6, y);
    await laptop.mouse.down();
    await laptop.mouse.move(area.x + area.width - 6, y, { steps: 12 });
    await laptop.mouse.up();
  }
  await expect(canvas).toHaveCSS('opacity', '0');
  await expect(laptop.getByText('Weekend in Porto!')).toBeVisible();
  await desktop.close();
});

test('a payment is confirmed on the return page even if the webhook never arrives', async ({
  page,
}) => {
  await startGift(page, 'Lucia');
  await addTextCard(page, 'For you');
  await fillSurprise(page, 'Dinner on Saturday');
  // Nothing PRO in it: it could be published free, but the creator wants it without watermark.
  await openPreview(page);
  await page
    .getByRole('button', { name: 'Remove the watermark, pick the link, keep it forever' })
    .click();
  const upgrade = page.getByRole('dialog', { name: 'The full experience' });

  // The customer pays at "Stripe" before being sent back; no webhook is delivered at all.
  const sessionCreated = page.waitForResponse((response) =>
    response.url().endsWith('/payments/checkout-session'),
  );
  await page.route('**/create/*/success', async (route) => {
    const session = await lastCheckoutSession();
    await fetch(`http://127.0.0.1:4242/__sessions/${session.id}/pay`, { method: 'POST' });
    await route.continue();
  });
  await upgrade.getByRole('button', { name: 'Pay €4.99' }).click();
  await sessionCreated;

  await expect(page.getByRole('heading', { name: 'Your gift has everything' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code of your gift' })).toBeVisible();
});
