# 3D benchmark

Produced by `pnpm bench:3d` (`tests/browser/bench-3d.spec.ts`). Frame time is measured over
120 animation frames per viewport; draw calls come from `renderer.info`, which counts
calls and triangles, not GPU memory. Spec tokens are an estimate (bytes / 4), not a model count.

- browser: chromium 153.0.8010.12
- gpu: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- os: win32 10.0.26200 x64
- cpu: Intel(R) Core(TM) i7-14700K x28
- emulation: 375 and 768 use mobile + touch emulation in desktop Chromium, not real devices

| Fixture | Viewport | Frame p50 ms | Frame p95 ms | Draw calls | Triangles | Context loss | 10-cycle leak |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| scene-3d-basic | mobile 375 | 16.7 | 16.7 | 5 | 2434 | lost → ready | no |
| scene-3d-basic | tablet 768 | 16.7 | 16.8 | 5 | 2434 | lost → ready | no |
| scene-3d-basic | desktop 1440 | 16.7 | 16.7 | 5 | 2434 | lost → ready | no |
| scene-3d-dense | mobile 375 | 16.7 | 16.8 | 49 | 44802 | lost → ready | no |
| scene-3d-dense | tablet 768 | 16.7 | 33.4 | 49 | 44802 | lost → ready | no |
| scene-3d-dense | desktop 1440 | 33.3 | 50 | 49 | 44802 | lost → ready | no |

| Fixture | Spec bytes | Spec tokens (est.) | Agent round-trips | HTML bytes | PNG export ok | Export p50 ms | Export p95 ms |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| scene-3d-basic | 1305 | 326 | 2 (render, export) | 633090 | 5/5 | 1047.12 | 1098.88 |
| scene-3d-dense | 5409 | 1352 | 2 (render, export) | 650398 | 5/5 | 1061.9 | 1212.4 |
