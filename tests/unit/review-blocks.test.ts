import { describe, expect, it } from 'vitest';
import { compile, validate } from '../../src/index.js';

const DECISION = {
  type: 'decision',
  id: 'rollback',
  question: 'How do we roll back?',
  text: 'Both keep the **data** in place.',
  options: [
    { label: 'Flip the flag', text: 'Instant.', recommended: true },
    { label: 'Point DNS back', text: 'Takes up to the `ttl`.' },
  ],
};

const page = (blocks: unknown[]) => ({ version: 1, meta: { title: 'Plan' }, blocks });

const messages = (blocks: unknown[]): string[] =>
  validate(page(blocks)).diagnostics.map((diagnostic) => diagnostic.message);

describe('review checks', () => {
  it('accepts decisions with one feedback block', () => {
    expect(messages([DECISION, { type: 'feedback' }])).toEqual([]);
  });

  it('requires a feedback block for a decision', () => {
    expect(messages([DECISION])).toEqual([
      'a decision needs a "feedback" block on the page, which copies the answers',
    ]);
  });

  it('allows one feedback block per page', () => {
    expect(
      messages([
        { type: 'feedback', id: 'a' },
        { type: 'feedback', id: 'b' },
      ]),
    ).toEqual(['a page has one feedback block; block "a" is already one']);
  });

  it('allows one recommended option and unique labels', () => {
    const options = [
      { label: 'Same', recommended: true },
      { label: 'Same', recommended: true },
    ];
    expect(messages([{ ...DECISION, options }, { type: 'feedback' }])).toEqual([
      'a decision recommends at most one option',
      'option "Same" is listed twice',
    ]);
  });
});

describe('review rendering', () => {
  it('renders a decision as a fieldset with the recommended option checked', () => {
    const { html } = compile(page([DECISION, { type: 'feedback' }]));
    expect(html).toContain('<legend>How do we roll back?</legend>');
    expect(html).toContain('Both keep the <strong>data</strong> in place.');
    expect(html).toContain('Takes up to the <code>ttl</code>.');
    expect(html).toContain(
      '<input checked data-ak-recommended disabled id="rollback-option-0" name="rollback" type="radio" value="Flip the flag" />',
    );
    expect(html).toContain(
      '<input disabled id="rollback-option-1" name="rollback" type="radio" value="Point DNS back" />',
    );
    expect(html).toContain('<label for="rollback-note">Note</label>');
  });

  it('renders the feedback panel with its controls disabled until the runtime runs', () => {
    const { html } = compile(page([{ type: 'feedback' }]));
    expect(html).toContain('<h2>Your feedback</h2>');
    expect(html).toContain(
      '<button type="button" class="ak-btn" data-variant="primary" data-ak-feedback-copy disabled>Copy feedback</button>',
    );
    expect(html).toContain('Answering and commenting work when JavaScript is on.');
  });

  it('keys stored comments by page content', () => {
    const key = (title: string): string =>
      compile(page([{ type: 'text', text: title }, { type: 'feedback' }])).html.match(
        /data-ak-review-key="([^"]+)"/u,
      )?.[1] ?? '';
    expect(key('a')).toBe(key('a'));
    expect(key('a')).not.toBe(key('b'));
  });

  it('ships the review sheet and runtime only when a review block is used', () => {
    const plain = compile(page([{ type: 'text', text: 'Hi' }]));
    expect(plain.features).not.toContain('review');
    expect(plain.html).not.toContain('.ak-decision{');
    expect(plain.html).not.toContain('wireReview');

    const review = compile(page([DECISION, { type: 'feedback' }]));
    expect(review.features).toEqual(expect.arrayContaining(['review', 'copy']));
    expect(review.html).toContain('.ak-decision{');
    expect(review.html).toContain('wireReview();');
  });

  it('is deterministic', () => {
    const spec = page([DECISION, { type: 'feedback' }]);
    expect(compile(spec).html).toBe(compile(spec).html);
  });
});
