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
| scene-3d-basic | mobile 375 | low@1 | 16.7 / 16.8 | 0.2 / 0.3 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | tablet 768 | low@1 | 16.7 / 16.7 | 0.2 / 0.4 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop 1440 | high@1 | 16.7 / 33.4 | 0.3 / 0.5 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop-2x 1440 | high@2 | 66.7 / 83.4 | 0.3 / 0.6 | 5 | 2,434 | lost → ready | no |
| scene-3d-dense | mobile 375 | low@1 | 16.7 / 33.4 | 0.4 / 0.9 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | tablet 768 | low@1 | 33.3 / 33.4 | 0.4 / 0.7 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | desktop 1440 | high@1 | 50.0 / 66.7 | 0.6 / 1.0 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | desktop-2x 1440 | high@2 | 100.1 / 133.4 | 0.6 / 0.8 | 49 | 44,802 | lost → ready | no |
| network-3d-basic | mobile 375 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 3,242 | lost → ready | no |
| network-3d-basic | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| network-3d-basic | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 4 | 5,762 | lost → ready | no |
| network-3d-stress | mobile 375 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 3 | 180,000 | lost → ready | no |
| network-3d-stress | tablet 768 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 3 | 180,000 | lost → ready | no |
| network-3d-stress | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 3 | 320,000 | lost → ready | no |
| network-3d-stress | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 3 | 320,000 | lost → ready | no |
| scatter-3d-20k | mobile 375 | low@1 | 16.7 / 16.7 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | tablet 768 | low@1 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop 1440 | high@1 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |
| scatter-3d-20k | desktop-2x 1440 | high@2 | 16.7 / 16.8 | 0.0 / 0.0 | 7 | 0 | lost → ready | no |

Agent cost is assumed, not measured: spec tokens are bytes / 4 and a page task is 2 calls (render, export). User tokens are not measured here; `pnpm bench:agent` measures live-model tokens.

| Fixture | Spec bytes | Spec tokens (assumed) | Round-trips (assumed) | HTML bytes | PNG export ok | Export p50 ms | Export max ms (n=5) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| scene-3d-basic | 1,276 | 319 | 2 | 693,811 | 5/5 | 2107.1 | 2237.3 |
| scene-3d-dense | 5,409 | 1,352 | 2 | 711,119 | 5/5 | 1702.7 | 1782.7 |
| network-3d-basic | 4,416 | 1,104 | 2 | 729,604 | 5/5 | 2070.9 | 2797.8 |
| network-3d-stress | 37,484 | 9,371 | 2 | 1,216,916 | 5/5 | 1906.5 | 2316.6 |
| scatter-3d-20k | 618,309 | 154,577 | 2 | 5,253,177 | 5/5 | 11926.6 | 12266.0 |

Export time includes launching the browser.
