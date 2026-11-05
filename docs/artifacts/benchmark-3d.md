# 3D benchmark

Produced by `pnpm bench:3d:update` (`tests/browser/bench-3d.spec.ts`); `pnpm bench:3d` re-runs it
and fails when draw calls or triangles drift from this baseline.

- **Frame ms** is the gap between 120 animation frames. It is vsync-capped (16.7 ms at 60 Hz), so it shows dropped frames, not headroom.
- **Render ms** times `renderer.render` alone on the CPU side of the call; it is the cost to compare.
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
| scene-3d-basic | tablet 768 | low@1 | 16.7 / 16.8 | 0.2 / 0.4 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop 1440 | high@1 | 16.7 / 33.4 | 0.2 / 0.5 | 5 | 2,434 | lost → ready | no |
| scene-3d-basic | desktop-2x 1440 | high@2 | 66.6 / 83.3 | 0.3 / 0.5 | 5 | 2,434 | lost → ready | no |
| scene-3d-dense | mobile 375 | low@1 | 16.7 / 16.7 | 0.4 / 0.8 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | tablet 768 | low@1 | 16.7 / 33.4 | 0.4 / 0.8 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | desktop 1440 | high@1 | 49.9 / 50.1 | 0.5 / 1.0 | 49 | 44,802 | lost → ready | no |
| scene-3d-dense | desktop-2x 1440 | high@2 | 100.0 / 133.3 | 0.5 / 1.3 | 49 | 44,802 | lost → ready | no |

Agent cost is assumed, not measured: spec tokens are bytes / 4 and a page task is 2 calls (render, export). User tokens are not measured here; `pnpm bench:agent` measures live-model tokens.

| Fixture | Spec bytes | Spec tokens (assumed) | Round-trips (assumed) | HTML bytes | PNG export ok | Export p50 ms | Export max ms (n=5) |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| scene-3d-basic | 1,305 | 326 | 2 | 633,321 | 5/5 | 1186.9 | 3110.1 |
| scene-3d-dense | 5,409 | 1,352 | 2 | 650,629 | 5/5 | 4620.3 | 7586.8 |

Export time includes launching the browser.
