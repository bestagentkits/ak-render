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
| scene-3d-basic | mobile 375 | low@1 | 16.7 / 16.7 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop 1440 | high@1 | 16.7 / 33.3 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop-2x 1440 | high@2 | 50.0 / 66.7 | 0.3 / 0.5 | 5 | 2,434 | lost → ready | no |
| network-3d-basic | mobile 375 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| network-3d-basic | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| scatter-3d-20k | mobile 375 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| bars-3d-dense | mobile 375 | low@1 | 16.7 / 16.8 | 1.4 / 1.7 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | tablet 768 | low@1 | 16.7 / 16.7 | 1.5 / 1.7 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | desktop 1440 | high@1 | 16.7 / 16.8 | 2.0 / 2.0 | 501 | 5,958 | lost → ready | no |
| bars-3d-dense | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 501 | 5,958 | lost → ready | no |
| model-3d-crate | mobile 375 | undefined@undefined | 16.7 / 16.7 | 0.1 / 0.2 | 2 | 24 | ready → ready | no |
| model-3d-crate | tablet 768 | undefined@undefined | 16.7 / 16.8 | 0.1 / 0.2 | 2 | 24 | ready → ready | no |
| model-3d-crate | desktop 1440 | undefined@undefined | 16.7 / 33.4 | 0.2 / 0.3 | 3 | 26 | ready → ready | no |
| model-3d-crate | desktop-2x 1440 | undefined@undefined | 83.4 / 100.1 | 0.2 / 0.4 | 3 | 26 | ready → ready | no |
| globe-3d-routes | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 40,786 | lost → ready | no |
| globe-3d-routes | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 40,066 | lost → ready | no |
| globe-3d-routes | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 8 | 57,618 | lost → ready | no |
| globe-3d-routes | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 8 | 57,618 | lost → ready | no |
| product-3d-speaker | mobile 375 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | tablet 768 | low@1 | 16.7 / 33.3 | 0.3 / 0.4 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 12 | 15,642 | lost → ready | no |
| product-3d-speaker | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 12 | 15,642 | lost → ready | no |
| particles-3d-galaxy | mobile 375 | low@1 | 16.7 / 16.8 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | tablet 768 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | desktop 1440 | high@1 | 16.7 / 16.7 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| particles-3d-galaxy | desktop-2x 1440 | high@1 | 16.7 / 33.4 | 0.1 / 0.2 | 1 | 0 | lost → ready | no |
| shader-3d-controls | mobile 375 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 1 | 1 | lost → ready | no |
| shader-3d-controls | tablet 768 | low@1 | 16.7 / 16.8 | 0.1 / 0.2 | 1 | 1 | lost → ready | no |
| shader-3d-controls | desktop 1440 | high@1 | 16.7 / 16.8 | 0.1 / 0.2 | 1 | 1 | lost → ready | no |
| shader-3d-controls | desktop-2x 1440 | high@2 | 50.0 / 66.7 | 0.2 / 0.3 | 1 | 1 | lost → ready | no |
| text-3d-hero | mobile 375 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 18 | 20,716 | lost → ready | no |
| text-3d-hero | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 18 | 20,716 | lost → ready | no |
| text-3d-hero | desktop 1440 | high@1 | 33.3 / 33.4 | 0.2 / 0.3 | 18 | 33,820 | lost → ready | no |
| text-3d-hero | desktop-2x 1440 | high@2 | 66.7 / 83.4 | 0.2 / 0.3 | 18 | 33,820 | lost → ready | no |
| point-cloud-3d-basic | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| point-cloud-3d-basic | desktop-2x 1440 | high@2 | 16.7 / 16.7 | 0.0 / 0.0 | 5 | 2 | lost → ready | no |
| timeline-3d-space | mobile 375 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | desktop 1440 | high@1 | 16.7 / 16.7 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| timeline-3d-space | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 16 | 29,762 | lost → ready | no |
| morph-3d-shapes | mobile 375 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | tablet 768 | low@1 | 16.7 / 16.7 | 0.1 / 0.2 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | desktop 1440 | high@1 | 33.3 / 50.0 | 0.3 / 0.4 | 2 | 10,802 | lost → ready | no |
| morph-3d-shapes | desktop-2x 1440 | high@2 | 100.0 / 116.7 | 0.3 / 0.4 | 2 | 10,802 | lost → ready | no |
| terrain-3d-alpine | mobile 375 | low@1 | 66.6 / 83.4 | 0.2 / 0.3 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | tablet 768 | low@1 | 83.4 / 116.7 | 0.1 / 0.3 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | desktop 1440 | high@1 | 150.1 / 200.0 | 0.2 / 0.4 | 6 | 132,092 | lost → ready | no |
| terrain-3d-alpine | desktop-2x 1440 | high@2 | 333.4 / 416.7 | 0.2 / 0.4 | 6 | 132,092 | lost → ready | no |

Agent cost is assumed, not measured: spec tokens are bytes / 4 and a page task is 2 calls (render, export). User tokens are not measured here; `pnpm bench:agent` measures live-model tokens.

| Fixture | Spec bytes | Spec tokens (assumed) | Round-trips (assumed) | HTML bytes | PNG export ok | Export p50 ms | Export max ms (n=5) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| scene-3d-basic | 1,276 | 319 | 2 | 1,040,838 | 5/5 | 954.5 | 1003.2 |
| network-3d-basic | 4,416 | 1,104 | 2 | 1,075,609 | 5/5 | 1095.9 | 1264.1 |
| scatter-3d-20k | 618,309 | 154,577 | 2 | 5,599,182 | 5/5 | 6150.5 | 6517.0 |
| bars-3d-dense | 6,080 | 1,520 | 2 | 1,311,688 | 5/5 | 1126.6 | 1164.3 |
| model-3d-crate | 923 | 231 | 2 | 1,045,845 | 5/5 | 1040.9 | 1093.5 |
| globe-3d-routes | 8,570 | 2,143 | 2 | 1,141,221 | 5/5 | 1080.4 | 1107.6 |
| product-3d-speaker | 4,997 | 1,249 | 2 | 1,052,660 | 5/5 | 1140.7 | 1151.8 |
| particles-3d-galaxy | 257 | 64 | 2 | 1,166,391 | 5/5 | 881.7 | 901.7 |
| shader-3d-controls | 717 | 179 | 2 | 1,671,383 | 5/5 | 1329.5 | 1356.1 |
| text-3d-hero | 223 | 56 | 2 | 1,038,480 | 5/5 | 1044.8 | 1056.1 |
| point-cloud-3d-basic | 21,880 | 5,470 | 2 | 1,106,343 | 5/5 | 924.6 | 960.6 |
| timeline-3d-space | 2,321 | 580 | 2 | 1,054,569 | 5/5 | 1096.2 | 1109.4 |
| morph-3d-shapes | 843 | 211 | 2 | 1,105,288 | 5/5 | 1247.9 | 1266.0 |
| terrain-3d-alpine | 1,644 | 411 | 2 | 1,572,564 | 5/5 | 1115.5 | 1147.9 |

Export time includes launching the browser.

Known gaps: a context loss state of `ready → ready` means the runtime ignores WebGL context loss.

- model-3d-crate: https://github.com/bestagentkits/ak-render/issues/177
