# 3D benchmark

Produced by `pnpm bench:3d:update` (`tests/browser/bench-3d.spec.ts`); `pnpm bench:3d` re-runs it
and fails when draw calls or triangles drift from this baseline.

- **Frame ms** is the gap between 120 animation frames. It is vsync-capped (16.7 ms at 60 Hz), so it shows dropped frames, not headroom.
- **Render ms** is CPU submit time of `renderer.render` only; it excludes GPU work, which frame ms shows on a software GPU.
- **Draws** and **triangles** come from `renderer.info`; they are not a GPU memory measurement.
- **Profile** is the runtime quality tier and device pixel ratio: `low` (coarse pointer) has no shadows or antialiasing, so rows with different profiles are not comparable.
- **Software renderer.** This baseline ran on a software GPU (SwiftShader), headless; real hardware is faster. Compare runs on the same machine only.

- browser: chromium 153.0.8010.12
- headless: true
- gpu: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- softwareGpu: true
- os: win32 10.0.26200 x64
- cpu: Intel(R) Core(TM) i7-14700K x28
- emulation: 375 and 768 use mobile and touch emulation in desktop Chromium, not real devices

| Fixture | Viewport | Profile | Frame p50 / p95 ms | Render p50 / p95 ms | Draws | Triangles | Context loss | 10-cycle leak |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| scene-3d-basic | mobile 375 | low@1 | 16.7 / 16.7 | 0.2 / 0.4 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop 1440 | high@1 | 16.7 / 16.8 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop-2x 1440 | high@2 | 50.0 / 50.1 | 0.2 / 0.4 | 5 | 2,434 | lost → ready | no |
| network-3d-basic | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| network-3d-basic | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| scatter-3d-20k | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | tablet 768 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop 1440 | high@1 | 16.7 / 16.7 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| bars-3d-dense | mobile 375 | low@1 | 16.7 / 16.8 | 2.9 / 4.6 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | tablet 768 | low@1 | 16.7 / 16.8 | 2.9 / 4.4 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 501 | 5,958 | lost → ready | no |
| model-3d-crate | mobile 375 | undefined@undefined | 16.7 / 16.8 | 0.2 / 0.3 | 2 | 24 | lost → ready | no |
| model-3d-crate | tablet 768 | undefined@undefined | 16.7 / 16.7 | 0.2 / 0.3 | 2 | 24 | lost → ready | no |
| model-3d-crate | desktop 1440 | undefined@undefined | 33.2 / 33.4 | 0.2 / 0.4 | 3 | 26 | lost → ready | no |
| model-3d-crate | desktop-2x 1440 | undefined@undefined | 100.0 / 100.1 | 0.3 / 0.4 | 3 | 26 | lost → ready | no |
| globe-3d-routes | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 40,786 | lost → ready | no |
| globe-3d-routes | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 40,066 | lost → ready | no |
| globe-3d-routes | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 57,618 | lost → ready | no |
| globe-3d-routes | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 8 | 57,618 | lost → ready | no |
| product-3d-speaker | mobile 375 | low@1 | 16.7 / 16.8 | 0.4 / 1.0 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | desktop 1440 | high@1 | 16.7 / 16.7 | 0.0 / 0.0 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 12 | 15,642 | lost → ready | no |
| particles-3d-galaxy | mobile 375 | low@1 | 16.7 / 16.8 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | tablet 768 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | desktop 1440 | high@1 | 16.7 / 16.8 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | desktop-2x 1440 | high@1 | 16.7 / 49.9 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| shader-3d-controls | mobile 375 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 1 | 1 | lost → ready | no |
| shader-3d-controls | tablet 768 | low@1 | 16.7 / 16.8 | 0.1 / 0.3 | 1 | 1 | lost → ready | no |
| shader-3d-controls | desktop 1440 | high@1 | 16.7 / 33.4 | 0.2 / 0.4 | 1 | 1 | lost → ready | no |
| shader-3d-controls | desktop-2x 1440 | high@2 | 50.0 / 66.7 | 0.2 / 0.3 | 1 | 1 | lost → ready | no |
| text-3d-hero | mobile 375 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 18 | 20,716 | lost → ready | no |
| text-3d-hero | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 18 | 20,716 | lost → ready | no |
| text-3d-hero | desktop 1440 | high@1 | 33.3 / 50.0 | 0.2 / 0.3 | 18 | 33,820 | lost → ready | no |
| text-3d-hero | desktop-2x 1440 | high@2 | 66.7 / 83.4 | 0.2 / 0.3 | 18 | 33,820 | lost → ready | no |
| point-cloud-3d-basic | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | tablet 768 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | desktop 1440 | high@1 | 16.7 / 16.7 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| timeline-3d-space | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | tablet 768 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | desktop 1440 | high@1 | 16.7 / 16.7 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| morph-3d-shapes | mobile 375 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.2 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | desktop 1440 | high@1 | 33.3 / 50.0 | 0.2 / 0.4 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | desktop-2x 1440 | high@2 | 99.9 / 116.7 | 0.2 / 0.3 | 2 | 10,802 | lost → ready | no |
| terrain-3d-alpine | mobile 375 | low@1 | 66.6 / 100.0 | 0.2 / 0.3 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | tablet 768 | low@1 | 100.0 / 133.3 | 0.1 / 0.3 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | desktop 1440 | high@1 | 166.7 / 250.0 | 0.2 / 0.4 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | desktop-2x 1440 | high@2 | 349.9 / 433.3 | 0.2 / 0.3 | 6 | 132,092 | lost → ready | no |

Agent cost is assumed, not measured: spec tokens are bytes / 4 and a page task is 2 calls (render, export). User tokens are not measured here; `pnpm bench:agent` measures live-model tokens.

| Fixture | Spec bytes | Spec tokens (assumed) | Round-trips (assumed) | HTML bytes | PNG export ok | Export p50 ms | Export max ms (n=5) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| scene-3d-basic | 1,276 | 319 | 2 | 1,041,780 | 5/5 | 1223.9 | 2062.4 |
| network-3d-basic | 4,416 | 1,104 | 2 | 1,076,551 | 5/5 | 1304.6 | 1420.5 |
| scatter-3d-20k | 618,309 | 154,577 | 2 | 5,600,124 | 5/5 | 9557.2 | 10476.2 |
| bars-3d-dense | 6,080 | 1,520 | 2 | 1,312,630 | 5/5 | 1909.7 | 2035.9 |
| model-3d-crate | 923 | 231 | 2 | 1,046,787 | 5/5 | 1863.4 | 3317.4 |
| globe-3d-routes | 8,570 | 2,143 | 2 | 1,142,163 | 5/5 | 1625.3 | 1735.3 |
| product-3d-speaker | 4,997 | 1,249 | 2 | 1,053,602 | 5/5 | 2097.6 | 2519.2 |
| particles-3d-galaxy | 257 | 64 | 2 | 1,167,333 | 5/5 | 1121.7 | 1156.3 |
| shader-3d-controls | 717 | 179 | 2 | 1,672,325 | 5/5 | 1465.3 | 1736.3 |
| text-3d-hero | 223 | 56 | 2 | 1,039,422 | 5/5 | 1337.5 | 1428.2 |
| point-cloud-3d-basic | 21,880 | 5,470 | 2 | 1,107,285 | 5/5 | 1126.8 | 1193.7 |
| timeline-3d-space | 2,321 | 580 | 2 | 1,055,511 | 5/5 | 1288.6 | 1359.1 |
| morph-3d-shapes | 843 | 211 | 2 | 1,106,230 | 5/5 | 1416.4 | 1446.8 |
| terrain-3d-alpine | 1,644 | 411 | 2 | 1,573,506 | 5/5 | 1292.5 | 1408.1 |

Export time includes launching the browser.
