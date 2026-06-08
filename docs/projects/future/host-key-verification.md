# Future project: host-key verification — known-hosts store + trust prompt

**Status:** NOT STARTED — exploratory, but **higher priority than most "future" docs
because it closes a real security gap.** Today fressh **auto-accepts every server host
key** (see Current state), which means no protection against a man-in-the-middle or a
spoofed server. This doc records what TOFU host-key verification should look like and how
it slots into the existing event plane.

**Scope (if pursued):** `apps/mobile` — a known-hosts store, a global trust-prompt UI, and
replacing the auto-accept in `ssh-store.ts`. No `@fressh/react-native-terminal` (native)
change: the seam (`HostKeyPending` event + `respondToHostKey`) already exists.

## Current state (the gap)

The native layer already does the right thing structurally — it **parks** the connection
on an unverified key and waits for a JS decision:

- On connect, fressh-core emits **`FresshEvent_Tags.HostKeyPending`** with
  `ServerPublicKeyInfo { host, port, remoteIp?, algorithm, fingerprintSha256, keyBase64 }`.
- JS decides and calls **`respondToHostKey(connectionId, accept)`** (`src/ssh.ts`) —
  `true` proceeds, `false` aborts with `SshError_Tags.HostKeyRejected`.

But the JS side punts. In `apps/mobile/src/lib/ssh-store.ts` (~:170):

```ts
case FresshEvent_Tags.HostKeyPending: {
  // Auto-accept (preserves the previous onServerKey -> true behavior).
  // TODO: surface a trust prompt and call respondToHostKey accordingly.
  respondToHostKey(event.inner.connectionId, true);
  break;
}
```

So **every** host key is trusted silently, every connect (there's no known-hosts store, so
even a *changed* key — the classic MITM signal — is accepted without a peep). This is the
TODO this doc turns into a plan.

## The model: trust-on-first-use (TOFU), like every SSH client

Mirror OpenSSH's `known_hosts` behavior:

1. **First time** we see a host → record its key fingerprint (after the user accepts).
   Optionally prompt, or silently pin-and-record (see Open questions on how aggressive).
2. **Same key next time** → silent accept. No prompt (the common case must be friction-free).
3. **Key changed** from what we recorded → **loud warning**: possible MITM, or the server
   was reinstalled / rekeyed. Require an explicit, deliberate "I trust the new key" to
   update the pin; default to reject.

## Architecture (reuse the event plane)

The event plane is a global fan-out (`addFresshEventListener`, single native listener →
many JS subscribers), so the host-key decision should be made by **one global handler**
mounted near the app root — then *every* connect path (the connect form, reconnect, and
the Commands-tab one-off runner) is covered uniformly, with no per-call wiring.

1. **Known-hosts store.** Host keys are **public** data, so this need NOT be the keychain —
   a dedicated MMKV-backed store (via the `definePref` factory, or a small JSON map) is
   enough and simpler. Shape: keyed by `host:port` → a list of trusted entries
   `{ algorithm, fingerprintSha256, keyBase64, trustedAtMs }` (a host can legitimately
   present different keys per algorithm). Compare on `fingerprintSha256`.
2. **The decision (replaces the auto-accept).** On `HostKeyPending`, look up the host:
   - **unknown host** → first-use: prompt (or pin-and-record per the chosen aggressiveness),
     then `respondToHostKey(id, accepted)`; on accept, store the entry.
   - **fingerprint matches** a stored entry → `respondToHostKey(id, true)` silently.
   - **host known but fingerprint differs** → the danger case: show a **changed-key
     warning** with both fingerprints; `respondToHostKey(id, true)` + update the pin only on
     explicit confirm, else `respondToHostKey(id, false)`.
3. **Trust-prompt UI.** A global modal (reuse `components/BottomSheet.tsx` or a centered
   dialog) showing host, algorithm, and `fingerprintSha256` (the readable identity), with
   **Reject** / **Trust** — and for the changed-key case, a distinct, scarier variant. The
   decision is async (waits for the user), so the handler holds the `connectionId` until
   the user answers, then calls `respondToHostKey`.

## A managed known-hosts surface (nice-to-have)

Once keys are stored, a **Settings → Security → Known hosts** screen lets the user view and
**revoke** trusted host keys (forget a host → re-prompt next connect). Mirrors `ssh-keygen
-R`. Pairs naturally with the existing Keys tab.

## Interaction with other features

- **Connect form / terminal** — gets the prompt for free once the global handler replaces
  the auto-accept.
- **Commands-tab one-off runner** ([preset-command-buttons.md](preset-command-buttons.md))
  — connecting to a not-currently-connected host currently relies on the auto-accept; once
  this lands it'll route through the same prompt. Worth doing *around* the same time so the
  one-off runner doesn't silently trust new hosts.

## Suggested phasing

- **v0 — pin + detect changes (minimal prompt).** Add the known-hosts store; replace the
  auto-accept with: unknown → record + accept (optionally a light first-use confirm),
  changed → **block + warn**. This alone closes the MITM-on-change gap with little UI.
- **v1 — first-use trust prompt.** Real prompt on unknown hosts (show fingerprint), not
  silent pinning.
- **v2 — known-hosts management screen** (view / revoke), and import/export of
  `known_hosts` if useful.

## Open questions

- **First-use: prompt or silent-pin?** OpenSSH prompts on first connect. Silent-pin
  (record without asking, only warn on change) is lower-friction and still catches MITM
  *after* first use — but the first connection itself is unverified (TOFU's inherent
  weakness). Which default? Leaning: light first-use confirm for the prompt, but pin-only
  is acceptable for v0.
- **Storage location.** MMKV/`definePref` (public data, simple) vs. the keychain store used
  for connections/keys (consistency). Host keys aren't secret → MMKV is fine; pick for
  consistency vs. simplicity.
- **Per-port / per-user scope.** Key the store on `host:port` (host keys are per-host, not
  per-user). Confirm.
- **Async decision plumbing.** The current handler responds synchronously; a prompt makes
  it async. Ensure the parked connection's `connectionId` is held correctly and that
  concurrent connects (two prompts at once) queue rather than clobber.
- **Multiple algorithms.** A server may offer ed25519 + rsa; record per-(algorithm,
  fingerprint) so an algorithm change isn't mistaken for a MITM.
- **Changed-key recovery UX.** How forcefully do we warn, and do we make "trust new key"
  deliberately awkward (type to confirm?) to avoid muscle-memory accept.
