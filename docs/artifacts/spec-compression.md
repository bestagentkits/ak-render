# Spec compression

Produced by `benchmarks/spec-compression.mjs` with compiler 0.3.0. Machine-readable
companion: [`spec-compression.json`](./spec-compression.json). Sizes are UTF-8 bytes.

- **Spec**: the fixture as written, with shared `datasets` and `dataRef`.
- **Inline data**: the same spec with every `dataRef` replaced by its rows.
- **Saved**: what the shared datasets save over inline data.
- **Read**: `catalog` text plus `describe --compact` for the block types used.

| Fixture | Block types | Spec | Inline data | Saved | HTML | HTML / spec | Read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| benchmark-report.yaml | 8 | 5.5 kB | 7.7 kB | 2.2 kB (28%) | 183.8 kB | 33.3× | 12.9 kB |
| complex-dashboard.yaml | 11 | 5.8 kB | 7.8 kB | 2.1 kB (27%) | 214.0 kB | 37.1× | 12.8 kB |
| incident-report.yaml | 10 | 5.8 kB | 6.5 kB | 0.7 kB (10%) | 168.8 kB | 28.9× | 12.5 kB |
| interactive-data-explorer.yaml | 9 | 4.3 kB | 5.4 kB | 1.2 kB (21%) | 176.9 kB | 41.6× | 12.6 kB |
| product-case-study.yaml | 9 | 5.7 kB | 6.2 kB | 0.5 kB (8%) | 135.9 kB | 23.9× | 11.1 kB |
| research-report.yaml | 14 | 5.7 kB | 5.9 kB | 0.3 kB (4%) | 139.6 kB | 24.7× | 12.3 kB |
| **Total** | | **32.7 kB** | **39.6 kB** | **6.8 kB (17%)** | **1019.0 kB** | | |

The catalog text is 8.0 kB on every row; the rest of
"Read" is the compact contract of each block type the fixture uses.

## Block types per fixture

- `benchmark-report.yaml`: benchmark-comparison, chart, data-table, hero, references, section, tabs, text
- `complex-dashboard.yaml`: callout, chart, data-table, grid, grid-item, hero, key-value, kpi, main-aside, section, stats
- `incident-report.yaml`: api-endpoint, callout, hero, kanban, log-viewer, roadmap, section, stats, test-results, timeline
- `interactive-data-explorer.yaml`: chart, data-table, filter-bar, hero, number-input, radio-group, section, select, text-input
- `product-case-study.yaml`: feature-matrix, gallery, hero, logo-cloud, people, pricing, section, stats, testimonial
- `research-report.yaml`: accordion, annotated-image, callout, hero, key-value, list, metric-breakdown, quote, references, section, sidebar-layout, stats, steps, text
