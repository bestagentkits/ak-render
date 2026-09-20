# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(**Security** → **Report a vulnerability**). Do not open a public issue for a
suspected vulnerability, and do not include exploit details in a public PR.

Please include the affected version or commit, the input Page Spec if it is
relevant, and whether the issue is reachable from a standalone artifact, from
the cloud renderer, or from both. We aim to acknowledge a report within five
working days and to publish a fix and advisory for confirmed issues.

## Supported versions

The project is pre-1.0. Only the latest published release line receives
security fixes; older prerelease versions are not patched.

## Threat model in brief

Page Spec input is **untrusted**. Specs may be authored by a model, a third
party, or a user, so the compiler treats every string, URL, identifier, and
numeric bound as hostile until validated.

In-scope assets:

- the compiler process that consumes a spec (local CLI, library caller, worker);
- the trust boundary of the emitted artifact, which must not be able to execute
  page-authored code;
- content that a user uploads to the opt-in cloud renderer, and the share
  artifacts derived from it.

Explicit non-goals and accepted risks:

- The emitted artifact is intended to be opened directly by the person who
  generated it. It is not a sandbox for third-party content served to a
  multi-tenant audience; a shared artifact is trusted by its viewer to the same
  degree as any downloaded HTML file.
- `file://` artifacts cannot rely on response headers for their security
  policy, so the emitted document must be self-defending (no page-authored
  script, strict escaping, allowlisted URL schemes).

Security-relevant invariants the compiler must maintain (each is covered by
fixtures as the corresponding milestone lands):

1. No page-authored JavaScript, event-handler source, raw HTML, or arbitrary
   `iframe`/`script` domain reaches the output.
2. Text, attribute, and URL escaping is applied at emission, not at parse time.
3. URL schemes are allowlisted per action and per widget.
4. Embedded JSON is serialized safely for a `script` context.
5. Network access is denied unless the spec explicitly opts in, and opt-in is
   capability-scoped rather than a blanket escape hatch.
6. Cloud rendering distinguishes an authenticated render (private, transient)
   from a published share (explicit, expiring, revocable).

## Secrets

The cloud renderer must never persist or log raw API keys or bearer tokens.
Repository tooling must never commit credentials. If you believe a credential
has been exposed, report it privately as above and rotate it before publishing
details.
