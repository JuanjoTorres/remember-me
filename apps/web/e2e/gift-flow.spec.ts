import { devices, expect, test } from '@playwright/test';
import { PHOTO } from './fixtures';
import { addTextCard, recordScripts } from './helpers';

test('a creator builds a free gift, hits the free limits and publishes it; the recipient opens it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Create a gift' }).click();
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Build the story' })).toBeVisible();

  // Names
  await page.getByRole('textbox', { name: 'For' }).fill('Sarah');
  await page.getByRole('textbox', { name: 'From' }).fill('Juan');

  // A card with an uploaded photo
  await page.getByRole('button', { name: '+ Photo & text' }).click();
  const sheet = page.getByRole('dialog', { name: 'Photo & text' });
  await sheet
    .getByLabel('Choose a photo')
    .first()
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(sheet.locator('img')).toHaveAttribute(
    'src',
    /\/gifts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/,
  );
  await sheet.getByRole('textbox', { name: /Text/ }).fill('Remember this day?');
  await sheet.getByRole('button', { name: 'Add card' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Remember this day?')).toBeVisible();

  // Cannot publish yet: the surprise is missing
  await expect(page.getByText('Still missing: the surprise')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish free' })).toBeDisabled();

  // Free limits open the upgrade sheet
  await addTextCard(page, 'Second card');
  await addTextCard(page, 'Third card');
  await expect(page.getByText('3 of 3 cards on the free plan.')).toBeVisible();
  await page.getByRole('button', { name: '+ Photo & text' }).click();
  const upgrade = page.getByRole('dialog', { name: 'The full experience' });
  await expect(upgrade.getByText(/up to 3 cards/)).toBeVisible();
  await upgrade.getByRole('checkbox').check();
  await upgrade.getByRole('textbox', { name: 'Custom link' }).fill('Te quiero, Sarah');
  await expect(upgrade.getByTestId('slug-preview')).toHaveText(
    'localhost:3000/for/te-quiero-sarah',
  );
  await expect(upgrade.getByText('Available')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(upgrade).toBeHidden();

  await page.getByRole('button', { name: /Voice note/ }).click();
  await expect(upgrade.getByText(/Voice notes and trivia/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Scratch card/ }).click();
  await expect(upgrade.getByText(/scratch card, the boarding pass/)).toBeVisible();
  await page.keyboard.press('Escape');

  // The surprise, then publish for free
  await page.getByRole('textbox', { name: /^The surprise/ }).fill('We are going to Lisbon!');
  await page.getByRole('textbox', { name: /^Message/ }).fill('Pack light.');
  await page.getByRole('heading', { name: 'The surprise', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish free' })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish free' }).click();

  await expect(page.getByRole('heading', { name: 'Your gift is live' })).toBeVisible();
  const link = page.getByRole('link', { name: /localhost:3000\/for\/sarah-[a-z0-9]{6}$/ });
  await expect(link).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code of your gift' })).toBeVisible();

  // The QR code downloads as a PNG
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download QR' }).click();
  expect((await download).suggestedFilename()).toMatch(/^remember-me-sarah-[a-z0-9]{6}\.png$/);

  // The private edit link reopens the editor in a clean browser
  await page.getByRole('button', { name: 'Copy edit link' }).click();
  const editLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(editLink).toMatch(/\/create\/[0-9a-f-]{36}#token=.+/);
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(editLink);
  await expect(otherPage.getByRole('heading', { name: 'Your gift is live' })).toBeVisible();
  await expect(otherPage).toHaveURL(/\/create\/[0-9a-f-]{36}$/);
  await other.close();

  // Without the link there is no access
  const stranger = await page.context().browser()!.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(page.url());
  await expect(
    strangerPage.getByRole('heading', { name: "This gift can't be edited from here" }),
  ).toBeVisible();
  await stranger.close();

  // --- The recipient scans the QR code ---
  const giftUrl = (await link.getAttribute('href')) as string;
  const recipient = await page
    .context()
    .browser()!
    .newContext({ ...devices['Pixel 7'], locale: 'es-ES' });
  const phone = await recipient.newPage();
  const scripts = recordScripts(phone);
  const mediaRequests: string[] = [];
  phone.on('request', (request) => {
    if (/\.(webp|m4a|mp3)$/.test(request.url())) mediaRequests.push(request.url());
  });

  const response = await phone.goto(giftUrl);
  expect(response?.status()).toBe(200);
  await expect(phone).toHaveTitle('A gift for Sarah');
  expect(await phone.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');

  // Cover, in the gift's language (English), whatever the phone's language is
  await expect(phone.getByRole('heading', { name: 'For Sarah' })).toBeVisible();
  await expect(phone.getByText('From Juan')).toBeVisible();
  // The photo of the first card is fetched while the cover is still showing
  await expect.poll(() => mediaRequests.length).toBeGreaterThan(0);
  await expect(phone.locator('img')).toHaveCount(0);

  await phone.getByRole('button', { name: 'Next' }).click();
  await expect(phone.getByText('Remember this day?')).toBeVisible();
  await expect(phone.locator('img')).toBeVisible();
  await phone.getByRole('button', { name: 'Next' }).click();
  await expect(phone.getByText('Second card')).toBeVisible();
  await phone.getByRole('button', { name: 'Back' }).click();
  await expect(phone.getByText('Remember this day?')).toBeVisible();
  await phone.getByRole('button', { name: 'Next' }).click();
  await phone.getByRole('button', { name: 'Next' }).click();
  await expect(phone.getByText('Third card')).toBeVisible();
  await phone.getByRole('button', { name: 'Next' }).click();

  // The surprise: free gifts open an envelope and end with the watermark
  await expect(phone.getByText('We are going to Lisbon!')).toBeHidden();
  await phone.getByRole('button', { name: 'Tap to open' }).click();
  await expect(phone.getByText('We are going to Lisbon!')).toBeVisible();
  await expect(phone.getByText('Pack light.')).toBeVisible();
  await expect(phone.getByTestId('watermark')).toHaveText('Created with remember.me');

  // The recipient's phone never downloads the editor, the checkout or Stripe
  const shipped = await scripts();
  expect(shipped.length).toBeGreaterThan(10_000);
  for (const marker of [
    'x-edit-token',
    'slug-preview',
    'checkout-session',
    'remember-me:gifts',
    'stripe',
  ]) {
    expect(shipped, `recipient bundle contains "${marker}"`).not.toContain(marker);
  }
  await recipient.close();

  // An unknown link gets a friendly page, in the visitor's language
  const lost = await page.context().browser()!.newContext({ locale: 'es-ES' });
  const lostPage = await lost.newPage();
  expect((await lostPage.goto('/for/no-existe-este-regalo'))?.status()).toBe(404);
  await expect(lostPage.getByRole('heading', { name: 'Este regalo no está aquí' })).toBeVisible();
  await lost.close();
});
