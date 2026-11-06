# 3D export release matrix

Produced by `pnpm export:matrix` (`scripts/export-matrix.mjs`). Measurements, not targets.
A row passes only when the frozen WebGL frame carries drawn pixels (local: sampled
frame colors >= 6 and lit share >= 0.02; PDF embeds the frame image;
cloud: Browser Run waited on the ready selector the in-page settle script sets only after
the same pixel check). A cloud row that could not run is `blocked`, never `pass`.

- generated: 2026-11-06T01:12:42.962Z
- compiler: 0.3.0
- commit: unknown
- os: win32 10.0.26200 x64
- cpu: Intel(R) Core(TM) i7-14700K x28
- node: v24.11.0
- localBrowser: 157.0.8103.38
- localBrowserSource: installed
- localRenderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)
- softwareGpu: false
- cloud: Cloudflare Browser Run Quick Actions

## Summary

- local: 28/28 pass, 0 fail
- cloud: 27/28 pass, 1 fail, 0 blocked
- repeats local scene-3d-basic: 20/20 (pass)
- repeats local product-3d-speaker: 20/20 (pass)
- repeats local globe-3d-routes: 20/20 (pass)
- repeats cloud scene-3d-basic: 20/20 (pass)
- repeats cloud product-3d-speaker: 20/20 (pass)
- repeats cloud globe-3d-routes: 20/20 (pass)

## Combinations

| Widget | Fixture | Format | Backend | Status | ms | Bytes | Frames (colors / lit) | Detail |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |
| scene-3d | scene-3d-basic | png | local | pass | 1458 | 1341543 | 2108x1184 267/0.248 |  |
| scene-3d | scene-3d-basic | png | cloud | pass | 12075 | 1988403 |  |  |
| scene-3d | scene-3d-basic | pdf | local | pass | 892 | 255719 | 2108x1184 267/0.248 |  |
| scene-3d | scene-3d-basic | pdf | cloud | pass | 4054 | 242252 |  |  |
| model-3d | model-3d-crate | png | local | pass | 1304 | 1923444 | 2108x1184 156/0.321 |  |
| model-3d | model-3d-crate | png | cloud | fail |  |  |  | webgl-unavailable: the page settled as webgl-unavailable (states: loading); the static plan is not exported as success |
| model-3d | model-3d-crate | pdf | local | pass | 967 | 850917 | 2108x1184 156/0.321 |  |
| model-3d | model-3d-crate | pdf | cloud | pass | 5229 | 815504 |  |  |
| product-3d | product-3d-speaker | png | local | pass | 1441 | 1749606 | 2108x1184 121/0.334 |  |
| product-3d | product-3d-speaker | png | cloud | pass | 14443 | 2417482 |  |  |
| product-3d | product-3d-speaker | pdf | local | pass | 1060 | 309583 | 2108x1184 121/0.334 |  |
| product-3d | product-3d-speaker | pdf | cloud | pass | 9922 | 290725 |  |  |
| particles-3d | particles-3d-galaxy | png | local | pass | 1192 | 2348357 | 2108x1184 49/0.416 |  |
| particles-3d | particles-3d-galaxy | png | cloud | pass | 5518 | 2846754 |  |  |
| particles-3d | particles-3d-galaxy | pdf | local | pass | 908 | 933651 | 2108x1184 49/0.416 |  |
| particles-3d | particles-3d-galaxy | pdf | cloud | pass | 8334 | 927497 |  |  |
| text-3d | text-3d-hero | png | local | pass | 1215 | 1258274 | 2108x1184 304/0.263 |  |
| text-3d | text-3d-hero | png | cloud | pass | 9822 | 1836147 |  |  |
| text-3d | text-3d-hero | pdf | local | pass | 1041 | 324355 | 2108x1184 304/0.263 |  |
| text-3d | text-3d-hero | pdf | cloud | pass | 9789 | 308290 |  |  |
| shader-3d | shader-3d-presets | png | local | pass | 4100 | 9573917 | 2108x1184 68/0.392, 2108x1184 38/0.333, 2108x1184 40/0.434, 2108x1184 69/0.471, 2108x1184 75/0.48 |  |
| shader-3d | shader-3d-presets | png | cloud | pass | 16939 | 8260510 |  |  |
| shader-3d | shader-3d-presets | pdf | local | pass | 3924 | 12784847 | 2108x1184 68/0.392, 2108x1184 38/0.333, 2108x1184 40/0.434, 2108x1184 69/0.471, 2108x1184 75/0.48 |  |
| shader-3d | shader-3d-presets | pdf | cloud | pass | 18093 | 11076123 |  |  |
| morph-3d | morph-3d-shapes | png | local | pass | 1555 | 1584393 | 2108x1184 197/0.338 |  |
| morph-3d | morph-3d-shapes | png | cloud | pass | 10050 | 2160126 |  |  |
| morph-3d | morph-3d-shapes | pdf | local | pass | 1227 | 587286 | 2108x1184 197/0.338 |  |
| morph-3d | morph-3d-shapes | pdf | cloud | pass | 6534 | 358918 |  |  |
| network-3d | network-3d-basic | png | local | pass | 1421 | 2215523 | 2108x1184 268/0.143 |  |
| network-3d | network-3d-basic | png | cloud | pass | 5973 | 3076338 |  |  |
| network-3d | network-3d-basic | pdf | local | pass | 953 | 458665 | 2108x1184 268/0.143 |  |
| network-3d | network-3d-basic | pdf | cloud | pass | 4098 | 511093 |  |  |
| scatter-3d | scatter-3d-basic | png | local | pass | 1149 | 1845656 | 2108x1184 223/0.372 |  |
| scatter-3d | scatter-3d-basic | png | cloud | pass | 5261 | 2566017 |  |  |
| scatter-3d | scatter-3d-basic | pdf | local | pass | 785 | 348870 | 2108x1184 223/0.372 |  |
| scatter-3d | scatter-3d-basic | pdf | cloud | pass | 1930 | 417588 |  |  |
| bars-3d | bars-3d-stacked | png | local | pass | 1280 | 1664805 | 2108x1184 456/0.394 |  |
| bars-3d | bars-3d-stacked | png | cloud | pass | 10833 | 2411472 |  |  |
| bars-3d | bars-3d-stacked | pdf | local | pass | 954 | 272609 | 2108x1184 456/0.394 |  |
| bars-3d | bars-3d-stacked | pdf | cloud | pass | 7602 | 268375 |  |  |
| globe-3d | globe-3d-routes | png | local | pass | 1487 | 2671301 | 2108x1184 149/0.371 |  |
| globe-3d | globe-3d-routes | png | cloud | pass | 8570 | 3586699 |  |  |
| globe-3d | globe-3d-routes | pdf | local | pass | 977 | 612701 | 2108x1184 149/0.371 |  |
| globe-3d | globe-3d-routes | pdf | cloud | pass | 6181 | 721510 |  |  |
| point-cloud-3d | point-cloud-3d-basic | png | local | pass | 1173 | 1915477 | 2108x1184 188/0.214 |  |
| point-cloud-3d | point-cloud-3d-basic | png | cloud | pass | 6481 | 2745671 |  |  |
| point-cloud-3d | point-cloud-3d-basic | pdf | local | pass | 945 | 345641 | 2108x1184 188/0.214 |  |
| point-cloud-3d | point-cloud-3d-basic | pdf | cloud | pass | 3177 | 510387 |  |  |
| terrain-3d | terrain-3d-alpine | png | local | pass | 1360 | 1821139 | 2108x1184 217/0.35 |  |
| terrain-3d | terrain-3d-alpine | png | cloud | pass | 8388 | 2420380 |  |  |
| terrain-3d | terrain-3d-alpine | pdf | local | pass | 1312 | 741275 | 2108x1184 217/0.35 |  |
| terrain-3d | terrain-3d-alpine | pdf | cloud | pass | 25993 | 719875 |  |  |
| timeline-3d | timeline-3d-space | png | local | pass | 1417 | 1797426 | 2108x1184 175/0.094 |  |
| timeline-3d | timeline-3d-space | png | cloud | pass | 6805 | 2535874 |  |  |
| timeline-3d | timeline-3d-space | pdf | local | pass | 1090 | 355854 | 2108x1184 175/0.094 |  |
| timeline-3d | timeline-3d-space | pdf | cloud | pass | 10104 | 344165 |  |  |

## 20 consecutive PNG exports

| Backend | Fixture | Passed | ms p50 / p95 | Distinct PNG hashes | Status |
| --- | --- | ---: | --- | ---: | --- |
| local | scene-3d-basic | 20/20 | 1155 / 1280 | 1 | pass |
| local | product-3d-speaker | 20/20 | 1433 / 1767 | 2 | pass |
| local | globe-3d-routes | 20/20 | 1446 / 1510 | 6 | pass |
| cloud | scene-3d-basic | 20/20 | 7679 / 17324 | 20 | pass |
| cloud | product-3d-speaker | 20/20 | 8794 / 16300 | 2 | pass |
| cloud | globe-3d-routes | 20/20 | 5175 / 10839 | 1 | pass |

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
| cloud-gpu-probe | cloud | ready | ready | pass |

R2 consent, TTL, revoke and expiry for stored cloud artifacts are covered by
`tests/unit/cloud-artifact-export.test.ts`; frame time, draw calls, context loss and the
10-cycle leak check by `pnpm bench:3d` ([benchmark-3d.md](benchmark-3d.md)).
