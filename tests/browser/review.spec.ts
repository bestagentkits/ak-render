import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = browserWorkspace('review');

function planReview(): string {
  const source = readFileSync(`${pagesDir}/plan-review.yaml`, 'utf8');
  return `file://${workspace.write('plan-review', compile(source, { source: 'plan-review' }).html)}`;
}

async function selectText(page: Page, selector: string): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
}

async function copiedFeedback(page: Page): Promise<string> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { copied: string }).copied = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.locator('[data-ak-feedback-copy]').click();
  return page.evaluate(() => (window as unknown as { copied: string }).copied);
}

test.describe('review', () => {
  test('collects selection and section comments with decision answers into one text', async ({
    page,
  }) => {
    await page.goto(planReview());
    await selectText(page, '.ak-code .ak-line:nth-child(2)');
    await page.locator('.ak-review-float').click();
    await page.locator('.ak-review-editor textarea').fill('Mirror users too.');
    await page.locator('.ak-review-editor .ak-review-save').click();
    await expect(page.locator('[data-ak-live]')).toHaveText('Comment saved');

    await page.getByRole('button', { name: 'Comment on Steps' }).click();
    await expect(page.locator('.ak-review-editor textarea')).toBeFocused();
    await page.keyboard.type('Add a load test step.');
    await page.keyboard.press('Control+Enter');

    await page.getByLabel('Point DNS back to the old gateway').check();
    await page.locator('[data-ak-decision-note]').first().fill('No new dependency.');
    await page.locator('[data-ak-feedback-general]').fill('Looks good.');

    expect(await copiedFeedback(page)).toBe(
      [
        'Feedback on "Gateway Migration Plan"',
        '',
        '## Decisions',
        '1. How do we roll back a failed switch?',
        '   Answer: Point DNS back to the old gateway',
        '   Note: No new dependency.',
        '2. How long do we mirror before switching reads?',
        '   Answer: Seven days (the recommended option)',
        '',
        '## Comments',
        '1. On "Routing rule › gateway/routes.yaml › line 2"',
        '   > - match: /v1/orders',
        '   Mirror users too.',
        '2. On "Steps"',
        '   Add a load test step.',
        '',
        '## General notes',
        'Looks good.',
        '',
      ].join('\n'),
    );
  });

  test('keeps comments and answers across a reload, and clears them on a second click', async ({
    page,
  }) => {
    await page.goto(planReview());
    await page.getByRole('button', { name: 'Comment on Steps' }).click();
    await page.keyboard.type('Keep me.');
    await page.locator('.ak-review-editor .ak-review-save').click();
    await page.getByLabel('Fourteen days').check();
    await page.reload();

    await expect(page.locator('.ak-feedback-item')).toHaveCount(1);
    await expect(page.getByLabel('Fourteen days')).toBeChecked();
    await expect(page.locator('.ak-review-bar button')).toHaveText('1 comment · Review');

    const clear = page.locator('[data-ak-feedback-clear]');
    await clear.click();
    await expect(clear).toHaveText('Click again to clear');
    await clear.click();
    await expect(page.locator('.ak-feedback-item')).toHaveCount(0);
    await expect(page.getByLabel('Seven days')).toBeChecked();
  });

  test('a section button knows its comment and opens it for editing', async ({ page }) => {
    await page.goto(planReview());
    await page.getByRole('button', { name: 'Comment on Steps' }).click();
    await page.keyboard.type('First draft.');
    await page.keyboard.press('Control+Enter');

    const edit = page.getByRole('button', { name: 'Edit comment on Steps' });
    await expect(edit).toHaveText('Edit comment');
    await edit.click();
    await expect(page.locator('.ak-review-editor textarea')).toHaveValue('First draft.');
    await page.locator('.ak-review-editor textarea').fill('Second draft.');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.ak-feedback-item')).toHaveCount(1);
    await expect(page.locator('.ak-feedback-text')).toHaveText('Second draft.');
  });

  test('reopens a text comment by clicking the text, and jumps back to it from the list', async ({
    page,
  }) => {
    await page.goto(planReview());
    await selectText(page, '.ak-code .ak-line:nth-child(2)');
    await page.locator('.ak-review-float').click();
    await page.locator('.ak-review-editor textarea').fill('Mirror users too.');
    await page.keyboard.press('Control+Enter');
    await page.reload();

    const line = page.locator('.ak-code .ak-line').nth(1);
    await line.scrollIntoViewIfNeeded();
    const box = await line.boundingBox();
    if (box === null) throw new Error('line has no box');
    await page.mouse.click(box.x + 140, box.y + box.height / 2);
    await expect(page.locator('.ak-review-editor textarea')).toHaveValue('Mirror users too.');
    await page.keyboard.press('Escape');

    await page.locator('[data-ak-feedback]').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /^Go to Routing rule/ }).click();
    await expect(line).toBeInViewport();
    expect(await page.evaluate(() => CSS.highlights.get('ak-review-focus')?.size)).toBe(1);
  });

  test('cancels an edit with Escape and returns focus to the opener', async ({ page }) => {
    await page.goto(planReview());
    const opener = page.getByRole('button', { name: 'Comment on Steps' });
    await opener.click();
    await page.keyboard.type('Discard me.');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ak-review-editor')).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('.ak-feedback-item')).toHaveCount(0);
  });
});

test.describe('review without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('shows every question and option, with the recommended one checked', async ({ page }) => {
    await page.goto(planReview());
    await expect(page.getByLabel('Flip the routing flag')).toBeChecked();
    await expect(page.getByLabel('Flip the routing flag')).toBeDisabled();
    await expect(page.locator('.ak-review-nojs').first()).toBeVisible();
    await expect(page.locator('.ak-review-add')).toHaveCount(0);
  });
});
