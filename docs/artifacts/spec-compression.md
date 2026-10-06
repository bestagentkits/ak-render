# Spec compression

Produced by `benchmarks/spec-compression.mjs` with compiler 0.2.0. Machine-readable
companion: [`spec-compression.json`](./spec-compression.json). Sizes are UTF-8 bytes.

- **Spec**: the fixture as written, with shared `datasets` and `dataRef`.
- **Inline data**: the same spec with every `dataRef` replaced by its rows.
- **Saved**: what the shared datasets save over inline data.
- **Read**: `catalog` text plus `describe --compact` for the block types used.

| Fixture | Block types | Spec | Inline data | Saved | HTML | HTML / spec | Read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| benchmark-report.yaml | 8 | 5.5 kB | 7.7 kB | 2.2 kB (28%) | 183.4 kB | 33.2× | 11.9 kB |
| complex-dashboard.yaml | 11 | 5.8 kB | 7.8 kB | 2.1 kB (27%) | 213.7 kB | 37.1× | 11.8 kB |
| incident-report.yaml | 10 | 5.8 kB | 6.5 kB | 0.7 kB (10%) | 167.9 kB | 28.7× | 11.6 kB |
| interactive-data-explorer.yaml | 9 | 4.3 kB | 5.4 kB | 1.2 kB (21%) | 176.5 kB | 41.5× | 11.7 kB |
| product-case-study.yaml | 9 | 5.7 kB | 6.2 kB | 0.5 kB (8%) | 135.7 kB | 23.8× | 10.2 kB |
| research-report.yaml | 14 | 5.7 kB | 5.9 kB | 0.3 kB (4%) | 139.3 kB | 24.6× | 11.4 kB |
| **Total** | | **32.7 kB** | **39.6 kB** | **6.8 kB (17%)** | **1016.5 kB** | | |

The catalog text is 7.2 kB on every row; the rest of
"Read" is the compact contract of each block type the fixture uses.

## Block types per fixture

- `benchmark-report.yaml`: benchmark-comparison, chart, data-table, hero, references, section, tabs, text
- `complex-dashboard.yaml`: callout, chart, data-table, grid, grid-item, hero, key-value, kpi, main-aside, section, stats
- `incident-report.yaml`: api-endpoint, callout, hero, kanban, log-viewer, roadmap, section, stats, test-results, timeline
- `interactive-data-explorer.yaml`: chart, data-table, filter-bar, hero, number-input, radio-group, section, select, text-input
- `product-case-study.yaml`: feature-matrix, gallery, hero, logo-cloud, people, pricing, section, stats, testimonial
- `research-report.yaml`: accordion, annotated-image, callout, hero, key-value, list, metric-breakdown, quote, references, section, sidebar-layout, stats, steps, text
