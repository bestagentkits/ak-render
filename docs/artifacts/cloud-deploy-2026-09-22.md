# Cloud renderer deployment

Observed state of the opt-in Worker. This is an operations record, not a
specification: the procedure lives in `apps/cloud/README.md`, and the committed
`wrangler.jsonc` is the configuration of record.

**Deployed 2026-09-22. No credentials appear in this file.**

## Deployment

| Fact | Value |
| --- | --- |
| Worker name | `ak-render-cloud` |
| URL | `https://ak-render-cloud.digitop-vn.workers.dev` |
| Version ID | `b3f1528a-f9d6-45cc-8f36-3711777e917a` |
| Upload | 411.58 KiB, gzip 93.41 KiB |
| Worker startup | 7 ms |
| Cron | `0 * * * *` (hourly share-expiry sweep) |

Bindings attached at deploy time:

| Binding | Resource |
| --- | --- |
| `RENDER_SHARES` | R2 bucket `ak-render-shares` (private) |
| `RATE_LIMIT` | KV namespace `1e8e95424a9c4ac7bc774cb689842438` |
| `ENTITLEMENTS_URL` | `https://api.agentkit.best` |
| `SHARE_RETENTION_DAYS` | `30` |

`workers_dev` was enabled for this first deployment so the Worker is reachable
and verifiable. Add a custom route before treating this as a production surface.

## Live checks

| Request | Observed |
| --- | --- |
| `GET /v1/share/<unknown-uuid>` | `404` `{"code":"NOT_FOUND","message":"no such share"}` |
| `POST /v1/render` with no bearer | `401` `{"code":"UNAUTHENTICATED","message":"a bearer token is required"}` |
| `POST /v1/render` with a bogus bearer | `502` `{"code":"ENTITLEMENTS_ERROR","message":"the entitlements endpoint answered 530"}` |
| `GET /v1/nope` | `404` `{"code":"NOT_FOUND","message":"no such route"}` |

The preview route resolves without a bearer and refuses an unknown share, the
render route requires a bearer, and the entitlements check is genuinely reached.

## Unresolved dependency

`ENTITLEMENTS_URL` points at `https://api.agentkit.best`, which answered `530`
(Cloudflare origin unreachable) during verification. The Worker fails closed with
`502` in that case, which is the designed behavior, but it means **authenticated
render, share, and export cannot succeed until that endpoint is live and
answering `POST /v1/entitlements/verify`**. Point `ENTITLEMENTS_URL` at the
correct origin for the environment to close this.

## Not deployed

The Browser Run binding is absent, so `POST /v1/screenshot` and `POST /v1/pdf`
answer `501 EXPORT_UNAVAILABLE`. That is the documented behavior of a deployment
without the export capability, not a failure.
