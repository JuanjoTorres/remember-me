import { devices, expect, test } from '@playwright/test';
import { PHOTO } from './fixtures';
import { addTextCard, openPreview, recordScripts } from './helpers';

test('a creator tries everything for free, previews the gift and publishes it free; the recipient opens it; the creator deletes it', async ({
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

  // Cannot preview yet: the surprise is missing
  await expect(page.getByText('Still missing: the surprise')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview and publish' })).toBeDisabled();

  await addTextCard(page, 'Second card');
  await addTextCard(page, 'Third card');
  await expect(page.getByText(/3 cards so far\. Up to 3 are free/)).toBeVisible();
  await expect(page.getByTestId('pro-summary')).toHaveCount(0);

  // Nothing is blocked while editing: a fourth card and a premium reveal are free to try, and the
  // editor only keeps count of what is PRO.
  const upgrade = page.getByRole('dialog', { name: 'The full experience' });
  await addTextCard(page, 'Fourth card');
  await expect(upgrade).toBeHidden();
  await expect(page.getByTestId('pro-summary')).toContainText('More than 3 cards');
  await page.getByRole('button', { name: /Scratch card/ }).click();
  await expect(page.getByRole('button', { name: /Scratch card/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('pro-summary')).toContainText('More than 3 cards · Premium reveal');
  await expect(upgrade).toBeHidden();

  // Back within the free plan: the summary goes away
  await page.getByRole('button', { name: 'Remove card' }).last().click();
  await expect(page.getByText('Fourth card')).toBeHidden();
  await page.getByRole('button', { name: /Envelope/ }).click();
  await expect(page.getByTestId('pro-summary')).toHaveCount(0);

  // The surprise, then the preview: the whole experience, not published yet
  await page.getByRole('textbox', { name: /^The surprise/ }).fill('We are going to Lisbon!');
  await page.getByRole('textbox', { name: /^Message/ }).fill('Pack light.');
  await page.getByRole('heading', { name: 'The surprise', exact: true }).click();
  await openPreview(page);
  await expect(page.getByRole('heading', { name: 'For Sarah' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Remember this day?')).toBeVisible();
  await expect(page.getByTestId('publish-note')).toContainText(
    'Free: it ends with “Created with kardoo.me”',
  );

  // No PRO feature in it: it is published for free, straight to its QR code
  await page.getByRole('button', { name: 'Publish and get QR' }).click();
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}\/published$/);
  await expect(upgrade).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Your gift is live' })).toBeVisible();
  await expect(page.getByText(/You can still fix typos and swap photos until/)).toBeVisible();
  await expect(page.getByText(/Free gifts stay online until/)).toBeVisible();
  const link = page.getByRole('link', { name: /^localhost:3000\/[a-z0-9]{8}$/ });
  await expect(link).toBeVisible();
  await expect(page.getByRole('img', { name: 'QR code of your gift' })).toBeVisible();

  // The QR code downloads as a PNG
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download QR' }).click();
  expect((await download).suggestedFilename()).toMatch(/^remember-me-[a-z0-9]{8}\.png$/);

  // Back in the editor the recipient's name is fixed; the rest can still be corrected
  await page.getByRole('link', { name: 'Back to the editor' }).click();
  await expect(page).toHaveURL(/\/create\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('textbox', { name: /^For/ })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'From' })).toBeEnabled();
  // A published free gift keeps the limits of its plan
  await page.getByRole('button', { name: /Voice note/ }).click();
  await expect(upgrade.getByText(/Voice notes and trivia/)).toBeVisible();
  await upgrade.getByRole('checkbox').check();
  await upgrade.getByRole('textbox', { name: 'Custom link' }).fill('Te quiero, Sarah');
  await expect(upgrade.getByTestId('slug-preview')).toHaveText(
    /^localhost:3000\/[a-z0-9]{4}\/for\/te-quiero-sarah$/,
  );
  await page.keyboard.press('Escape');
  await expect(upgrade).toBeHidden();

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

  const response = await phone.goto(giftUrl, { waitUntil: 'networkidle' });
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
  await expect(phone.getByTestId('watermark')).toHaveText('Created with kardoo.me');

  // The recipient's phone never downloads the editor, the checkout or Stripe
  const shipped = await scripts();
  expect(shipped.length).toBeGreaterThan(10_000);
  for (const marker of [
    'x-edit-token',
    'slug-preview',
    'publish-note',
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
  for (const address of ['/x9k2bd7m', '/7k2m/for/no-existe-este-regalo', '/no-existe']) {
    expect((await lostPage.goto(address))?.status(), address).toBe(404);
    await expect(lostPage.getByRole('heading', { name: 'Este regalo no está aquí' })).toBeVisible();
  }
  await lost.close();

  // --- The creator deletes the gift for good ---
  const zone = page.getByRole('region', { name: 'Danger zone' });
  await zone.getByRole('button', { name: 'Delete this gift' }).click();
  await expect(zone.getByRole('button', { name: 'Delete forever' })).toBeDisabled();
  await zone.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
  await zone.getByRole('button', { name: 'Delete forever' }).click();
  await expect(page).toHaveURL(/localhost:3000\/$/);
  // The link stops working and the photo is gone from storage
  expect((await page.request.get(giftUrl)).status()).toBe(404);
  await expect
    .poll(async () => Promise.all(mediaRequests.map((url) => fetch(url).then((r) => r.status))))
    .toEqual(mediaRequests.map(() => 404));
});
