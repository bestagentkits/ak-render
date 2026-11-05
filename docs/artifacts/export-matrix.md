# 3D export release matrix

Produced by `pnpm export:matrix` (`scripts/export-matrix.mjs`). Measurements, not targets.
A row passes only when the frozen WebGL frame carries drawn pixels (local: sampled
frame colors >= 6 and lit share >= 0.02; PDF embeds the frame image;
cloud: Browser Run waited on the ready selector the in-page settle script sets only after
the same pixel check). A cloud row that could not run is `blocked`, never `pass`.

- generated: 2026-11-05T21:04:50.910Z
- compiler: 0.3.0
- commit: 22a4c7883ac5b59ce22df1e1ec4d5ec39f1621e4
- os: win32 10.0.26200 x64
- cpu: Intel(R) Core(TM) i7-14700K x28
- node: v24.11.0
- localBrowser: 157.0.8103.38
- localBrowserSource: installed
- localRenderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)
- softwareGpu: false
- cloud: blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set

## Summary

- local: 28/28 pass, 0 fail
- cloud: 0/28 pass, 0 fail, 28 blocked
- repeats local scene-3d-basic: 20/20 (pass)
- repeats local product-3d-speaker: 20/20 (pass)
- repeats local globe-3d-routes: 20/20 (pass)
- repeats cloud scene-3d-basic: 0/20 (blocked)
- repeats cloud product-3d-speaker: 0/20 (blocked)
- repeats cloud globe-3d-routes: 0/20 (blocked)

## Combinations

| Widget | Fixture | Format | Backend | Status | ms | Bytes | Frames (colors / lit) | Detail |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| scene-3d | scene-3d-basic | png | local | pass | 1345 | 1341543 | 2108x1184 267/0.248 |  |
| scene-3d | scene-3d-basic | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| scene-3d | scene-3d-basic | pdf | local | pass | 873 | 255719 | 2108x1184 267/0.248 |  |
| scene-3d | scene-3d-basic | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| model-3d | model-3d-crate | png | local | pass | 1246 | 1923444 | 2108x1184 156/0.321 |  |
| model-3d | model-3d-crate | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| model-3d | model-3d-crate | pdf | local | pass | 950 | 850917 | 2108x1184 156/0.321 |  |
| model-3d | model-3d-crate | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| product-3d | product-3d-speaker | png | local | pass | 1398 | 1749606 | 2108x1184 121/0.334 |  |
| product-3d | product-3d-speaker | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| product-3d | product-3d-speaker | pdf | local | pass | 1047 | 309583 | 2108x1184 121/0.334 |  |
| product-3d | product-3d-speaker | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| particles-3d | particles-3d-galaxy | png | local | pass | 1174 | 2348357 | 2108x1184 49/0.416 |  |
| particles-3d | particles-3d-galaxy | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| particles-3d | particles-3d-galaxy | pdf | local | pass | 858 | 933651 | 2108x1184 49/0.416 |  |
| particles-3d | particles-3d-galaxy | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| text-3d | text-3d-hero | png | local | pass | 1381 | 1258274 | 2108x1184 304/0.263 |  |
| text-3d | text-3d-hero | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| text-3d | text-3d-hero | pdf | local | pass | 1086 | 324355 | 2108x1184 304/0.263 |  |
| text-3d | text-3d-hero | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| shader-3d | shader-3d-presets | png | local | pass | 4061 | 9573931 | 2108x1184 68/0.392, 2108x1184 38/0.333, 2108x1184 40/0.434, 2108x1184 69/0.471, 2108x1184 75/0.48 |  |
| shader-3d | shader-3d-presets | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| shader-3d | shader-3d-presets | pdf | local | pass | 3902 | 12784852 | 2108x1184 68/0.392, 2108x1184 38/0.333, 2108x1184 40/0.434, 2108x1184 69/0.471, 2108x1184 75/0.48 |  |
| shader-3d | shader-3d-presets | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| morph-3d | morph-3d-shapes | png | local | pass | 1479 | 1584393 | 2108x1184 197/0.338 |  |
| morph-3d | morph-3d-shapes | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| morph-3d | morph-3d-shapes | pdf | local | pass | 1209 | 587286 | 2108x1184 197/0.338 |  |
| morph-3d | morph-3d-shapes | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| network-3d | network-3d-basic | png | local | pass | 1414 | 2215523 | 2108x1184 268/0.143 |  |
| network-3d | network-3d-basic | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| network-3d | network-3d-basic | pdf | local | pass | 937 | 458665 | 2108x1184 268/0.143 |  |
| network-3d | network-3d-basic | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| scatter-3d | scatter-3d-basic | png | local | pass | 1113 | 1845656 | 2108x1184 223/0.372 |  |
| scatter-3d | scatter-3d-basic | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| scatter-3d | scatter-3d-basic | pdf | local | pass | 953 | 348870 | 2108x1184 223/0.372 |  |
| scatter-3d | scatter-3d-basic | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| bars-3d | bars-3d-stacked | png | local | pass | 1274 | 1664805 | 2108x1184 456/0.394 |  |
| bars-3d | bars-3d-stacked | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| bars-3d | bars-3d-stacked | pdf | local | pass | 945 | 272609 | 2108x1184 456/0.394 |  |
| bars-3d | bars-3d-stacked | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| globe-3d | globe-3d-routes | png | local | pass | 1450 | 2671301 | 2108x1184 149/0.371 |  |
| globe-3d | globe-3d-routes | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| globe-3d | globe-3d-routes | pdf | local | pass | 920 | 612705 | 2108x1184 149/0.371 |  |
| globe-3d | globe-3d-routes | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| point-cloud-3d | point-cloud-3d-basic | png | local | pass | 1149 | 1915477 | 2108x1184 188/0.214 |  |
| point-cloud-3d | point-cloud-3d-basic | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| point-cloud-3d | point-cloud-3d-basic | pdf | local | pass | 827 | 345641 | 2108x1184 188/0.214 |  |
| point-cloud-3d | point-cloud-3d-basic | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| terrain-3d | terrain-3d-alpine | png | local | pass | 1343 | 1821139 | 2108x1184 217/0.35 |  |
| terrain-3d | terrain-3d-alpine | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| terrain-3d | terrain-3d-alpine | pdf | local | pass | 1047 | 741275 | 2108x1184 217/0.35 |  |
| terrain-3d | terrain-3d-alpine | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| timeline-3d | timeline-3d-space | png | local | pass | 1379 | 1797426 | 2108x1184 175/0.094 |  |
| timeline-3d | timeline-3d-space | png | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |
| timeline-3d | timeline-3d-space | pdf | local | pass | 1063 | 355857 | 2108x1184 175/0.094 |  |
| timeline-3d | timeline-3d-space | pdf | cloud | blocked |  |  |  | blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set |

## 20 consecutive PNG exports

| Backend | Fixture | Passed | ms p50 / p95 | Distinct PNG hashes | Status |
| --- | --- | ---: | --- | ---: | --- |
| local | scene-3d-basic | 20/20 | 1109 / 1149 | 1 | pass |
| local | product-3d-speaker | 20/20 | 1419 / 1485 | 2 | pass |
| local | globe-3d-routes | 20/20 | 1484 / 1576 | 11 | pass |
| cloud | scene-3d-basic | 0/20 | - / - | - | blocked (blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set) |
| cloud | product-3d-speaker | 0/20 | - / - | - | blocked (blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set) |
| cloud | globe-3d-routes | 0/20 | - / - | - | blocked (blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set) |

## Cases

| Case | Backend | Expected | Got | Status |
| --- | --- | --- | --- | --- |
| no-webgl | local | webgl-unavailable | webgl-unavailable | pass |
| exhausted-budget | local | timeout | timeout | pass |
| blocked-network | local | scene-error or timeout or load-failed | scene-error | pass |
| invalid-spec | local | invalid-spec | invalid-spec | pass |
| consent-missing | cloud | consent-required | consent-required | pass |
| consent-mismatch | cloud | consent-required | consent-required | pass |
| rejected-token | cloud | cloud-unauthorized | cloud-unauthorized | pass |

R2 consent, TTL, revoke and expiry for stored cloud artifacts are covered by
`tests/unit/cloud-artifact-export.test.ts`; frame time, draw calls, context loss and the
10-cycle leak check by `pnpm bench:3d` ([benchmark-3d.md](benchmark-3d.md)).
