import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  epochDay,
  layoutMonth,
  mondayIndex,
  parseMonth,
} from '../../src/blocks/product/calendar-dates.js';
import { LIGHTBOX } from '../../src/blocks/product/product-runtime.js';
import { compile } from '../../src/render/render.js';
import { validate } from '../../src/spec/validate.js';

function spec(blocks: unknown[], policy: unknown = 'deny'): unknown {
  return {
    version: 1,
    meta: { title: 'Product widgets test' },
    policy: { network: policy },
    blocks: [{ type: 'hero', title: 'Product widgets test' }, ...blocks],
  };
}

function errors(blocks: unknown[], policy: unknown = 'deny') {
  return validate(JSON.stringify(spec(blocks, policy))).diagnostics.filter(
    (item) => item.severity === 'error',
  );
}

const html = (blocks: unknown[], policy: unknown = 'deny') => compile(spec(blocks, policy)).html;

describe('calendar date math', () => {
  it('places Thursday 1 October 2026 in the fourth Monday-first column', () => {
    const layout = layoutMonth({ year: 2026, month: 10 }, 'monday');
    expect(layout.leading).toBe(3);
    expect(layout.days[0]).toEqual({ day: 1, iso: '2026-10-01', weekday: 3 });
    expect(layout.days).toHaveLength(31);
    expect((layout.leading + layout.days.length + layout.trailing) % 7).toBe(0);
  });

  it('shifts one column when weeks start on Sunday', () => {
    expect(layoutMonth({ year: 2026, month: 10 }, 'sunday').leading).toBe(4);
  });

  it('knows leap years', () => {
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2100, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2000, month: 2 })).toBe(29);
    expect(layoutMonth({ year: 2028, month: 2 }, 'monday').days.at(-1)?.iso).toBe('2028-02-29');
  });

  it('matches known weekdays across centuries', () => {
    expect(epochDay(1970, 1, 1)).toBe(0);
    expect(mondayIndex(1970, 1, 1)).toBe(3);
    expect(mondayIndex(2000, 1, 1)).toBe(5);
    expect(mondayIndex(1900, 1, 1)).toBe(0);
    expect(mondayIndex(2028, 2, 29)).toBe(1);
  });

  it('parses only real months', () => {
    expect(parseMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonth('2026-13')).toBeUndefined();
    expect(parseMonth('2026-1')).toBeUndefined();
  });
});

describe('calendar block', () => {
  const calendar = (extra: Record<string, unknown>) => ({
    type: 'calendar',
    id: 'cal',
    month: '2026-10',
    ...extra,
  });

  it('renders the month deterministically with sorted events and no today marker', () => {
    const blocks = [
      calendar({
        events: [
          { date: '2026-10-14', time: '14:00', title: 'Launch' },
          { date: '2026-10-14', time: '09:30', title: 'Checklist', tone: 'warning' },
          { date: '2026-10-14', title: 'All day' },
        ],
      }),
    ];
    const output = html(blocks);
    expect(output).toBe(html(blocks));
    expect(output).toContain('<time datetime="2026-10">October 2026</time>');
    expect(output.match(/class="ak-calendar-pad"/gu)).toHaveLength(3 + 1);
    const day = output.slice(output.indexOf('datetime="2026-10-14"'));
    expect(day.indexOf('All day')).toBeLessThan(day.indexOf('Checklist'));
    expect(day.indexOf('Checklist')).toBeLessThan(day.indexOf('Launch'));
    expect(output).not.toMatch(/today|aria-current="date"/u);
  });

  it('rejects a malformed month, an out-of-month date and a bad time at their paths', () => {
    expect(errors([calendar({ month: '2026-13' })]).map((item) => item.path)).toContain(
      '$.blocks[1].month',
    );
    const found = errors([
      calendar({
        events: [
          { date: '2026-11-01', title: 'Next month' },
          { date: '2026-02-30', title: 'Bad' },
          { date: '2026-10-02', time: '25:00', title: 'Late' },
        ],
      }),
    ]).map((item) => item.path);
    expect(found).toEqual(
      expect.arrayContaining([
        '$.blocks[1].events[0].date',
        '$.blocks[1].events[1].date',
        '$.blocks[1].events[2].time',
      ]),
    );
  });

  it('shows an empty-month note', () => {
    expect(html([calendar({})])).toContain('No events in October 2026.');
  });
});

describe('pricing', () => {
  const plan = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    price: 0,
    ...extra,
  });

  it('formats numeric prices and states the recommended plan in text', () => {
    const output = html([
      {
        type: 'pricing',
        plans: [
          plan('Free', { price: '$0', period: 'month' }),
          plan('Pro', { price: 29, currency: 'EUR', period: 'year', highlight: true }),
          plan('Lifetime', { price: 9.5, period: 'once' }),
        ],
      },
    ]);
    expect(output).toContain('<span class="ak-plan-amount">€29</span>');
    expect(output).toContain('<span class="ak-plan-amount">$9.50</span>');
    expect(output).toContain('<span class="ak-sr">per </span>year');
    expect(output).toContain('one-time');
    expect(output).toContain('<p class="ak-plan-badge">Recommended</p>');
  });

  it('allows at most one highlighted plan', () => {
    const found = errors([
      {
        type: 'pricing',
        plans: [plan('A', { highlight: true }), plan('B', { highlight: true })],
      },
    ]);
    expect(found.map((item) => item.path)).toEqual(['$.blocks[1].plans[1].highlight']);
  });
});

describe('feature matrix', () => {
  it('renders marks with visually hidden words and row headers', () => {
    const output = html([
      {
        type: 'feature-matrix',
        plans: ['Free', 'Pro'],
        rows: [{ feature: 'Export', values: [false, true] }],
      },
    ]);
    expect(output).toContain('<th scope="row">Export</th>');
    expect(output).toContain('<span class="ak-sr">Not included</span>');
    expect(output).toContain('<span class="ak-sr">Included</span>');
  });

  it('reports a value count that does not match the plans at the row path', () => {
    const found = errors([
      {
        type: 'feature-matrix',
        plans: ['Free', 'Pro', 'Team'],
        rows: [
          { feature: 'Ok', values: [true, true, true] },
          { feature: 'Short', values: [true, '10 GB'] },
        ],
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('$.blocks[1].rows[1].values');
    expect(found[0]?.details).toEqual({ expected: 3, actual: 2 });
  });
});

describe('testimonial', () => {
  const quote = (name: string) => ({ quote: `Said by ${name}.`, name });

  it('features a single quote and grids two or more', () => {
    expect(html([{ type: 'testimonial', items: [quote('A')] }])).toMatch(
      /data-layout="featured"[^>]*>(?:(?!<ul).)*<figure class="ak-testimonial">/u,
    );
    const grid = html([{ type: 'testimonial', items: [quote('A'), quote('B'), quote('C')] }]);
    expect(grid).toContain('data-layout="grid"');
    expect(grid.match(/<li><figure class="ak-testimonial">/gu)).toHaveLength(3);
  });

  it('falls back to initials for a blocked avatar and rejects a blocked logo', () => {
    const output = html([
      {
        type: 'testimonial',
        items: [{ ...quote('Ada Lovelace'), avatar: 'https://cdn.example.com/a.png' }],
      },
    ]);
    expect(output).toContain('data-initials="true" aria-hidden="true">AL</span>');
    expect(output).not.toContain('cdn.example.com');
    const found = errors([
      { type: 'testimonial', items: [{ ...quote('A'), logo: 'https://cdn.example.com/l.png' }] },
    ]);
    expect(found.map((item) => item.path)).toEqual(['$.blocks[1].items[0].logo']);
  });

  it('loads a remote avatar once images are allowed', () => {
    const output = html(
      [
        {
          type: 'testimonial',
          items: [{ ...quote('A'), avatar: 'https://cdn.example.com/a.png' }],
        },
      ],
      { allow: ['images'] },
    );
    expect(output).toContain('<img class="ak-avatar" src="https://cdn.example.com/a.png" alt=""');
  });
});

describe('logo cloud and people', () => {
  it('shows a blocked logo as its name and an allowed one as an image', () => {
    const output = html([
      {
        type: 'logo-cloud',
        items: [
          { name: 'Remote Co', src: 'https://cdn.example.com/r.svg' },
          { name: 'Local Co', src: 'assets/l.svg', href: 'https://example.com' },
        ],
      },
    ]);
    expect(output).toContain('<span class="ak-logo-name">Remote Co</span>');
    expect(output).toContain('<img src="assets/l.svg" alt="Local Co"');
    expect(output).toContain('href="https://example.com" rel="noreferrer noopener">');
  });

  it('renders people with headings, links and the bio limit', () => {
    const output = html([
      {
        type: 'people',
        items: [
          { name: 'Linh', role: 'Product', links: [{ label: 'Site', href: 'https://x.io' }] },
        ],
      },
    ]);
    expect(output).toContain('<h3>Linh</h3><p class="ak-person-role">Product</p>');
    expect(
      errors([{ type: 'people', items: [{ name: 'A', bio: 'x'.repeat(281) }] }]).map(
        (item) => item.path,
      ),
    ).toEqual(['$.blocks[1].items[0].bio']);
  });
});

describe('gallery lightbox', () => {
  const gallery = {
    type: 'gallery',
    id: 'shots',
    items: [
      { src: 'assets/a.webp', alt: 'First' },
      { src: 'https://cdn.example.com/b.webp', alt: 'Blocked' },
      { src: 'assets/c.webp', alt: 'Third', caption: 'Third shot' },
    ],
  };

  it('links each shown thumbnail to a full-size figure that works without scripts', () => {
    const result = compile(spec([gallery]));
    expect(result.features).toContain('lightbox');
    expect(result.html).toContain(
      '<a class="ak-lightbox-thumb" id="ak-lb-shots-1-thumb" href="#ak-lb-shots-1">',
    );
    expect(result.html).toContain('<figure class="ak-lightbox-figure" id="ak-lb-shots-2"');
    // The blocked image keeps its link fallback and gets no viewer entry.
    expect(result.html).not.toContain('id="ak-lb-shots-3"');
    expect(result.html).toContain('href="#ak-lb-shots-2">Next');
    expect(result.html).toContain('href="#ak-lb-shots-2">Previous');
    expect(result.html).toContain('href="#ak-lb-shots-1-thumb">Close');
    expect(result.html).toMatch(/:target\{position:fixed/u);
    expect(result.html).toContain('data-ak-live role="status"');
  });

  it('emits no viewer when every image is blocked', () => {
    const output = html([
      { type: 'gallery', items: [{ src: 'https://cdn.example.com/b.webp', alt: 'Blocked' }] },
    ]);
    expect(output).not.toContain('class="ak-lightbox-thumb"');
    expect(output).not.toMatch(/<section[^>]*data-ak-lightbox-root/u);
  });

  it('ships the lightbox sheet and runtime only on pages with a gallery', () => {
    const without = compile(spec([{ type: 'text', text: 'No images.' }]));
    expect(without.html).not.toContain('.ak-lightbox');
    expect(without.html).not.toContain('wireLightbox');
    expect(compile(spec([gallery])).html).toContain('wireLightbox();');
  });

  it('keeps the runtime in the conservative script style', () => {
    expect(LIGHTBOX).not.toMatch(/=>|`|\blet\b|\bconst\b/u);
  });
});
