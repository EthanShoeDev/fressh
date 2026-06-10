**Title**

- SSH connection/session IDs, API surface, and state ownership plan

**Goals**

- Remove dependency on expo-crypto for session keys.
- Make it possible to deep-link/open a Shell screen for any active shell.
- Expose a stable connection id from Rust; avoid overloading channelId for
  cross‑screen identity.
- Smooth JS API that merges records + callbacks without losing UniFFI object
  pointers.

**Constraints**

- UniFFI objects (SshConnection, ShellSession) must not be spread/cloned in JS;
  doing so loses the hidden native pointer.
- UniFFI supports returning records and objects, but not a composite in one
  return. Records can be fetched via methods and merged in JS.
- channelId is scoped to a connection and a specific shell lifetime; it can
  change when new shells are created.

**Russh capabilities and connection identity**

- Reviewed `russh/examples/client_exec_simple.rs` (Eugeny/russh). The public
  `client::Handle` API does not expose a built‑in connection identifier, nor
  socket `local_addr/peer_addr` accessors.
- The library exposes channel ids on per‑channel messages, but not a persistent
  connection id.
- Conclusion: There is no "intrinsic" connection id to reuse. A meaningful id
  should be derived from connection details plus a disambiguator.

Recommended connection id shape

- Human‑readable base: `username@host:port`
- Disambiguator: creation timestamp (ms since epoch) to uniquely tag each
  instance.
- Final id example: `demo@test.rebex.net:22|1726312345678`
  - Deterministic, meaningful, and avoids a global counter.

Alternatives considered

- Per‑endpoint sequence number: works but requires a global counter map;
  timestamp keeps it simpler and still unique.
- Local TCP port: not exposed by russh; unstable across reconnects; unsuitable
  for UX and deep‑linking.
- SSH session identifier: not publicly exposed by russh; would require upstream
  changes.
- Server host key fingerprint: great metadata but not unique per connection;
  retain as optional info.

**Proposed API Changes (Rust crate)**

- Add a stable `connection_id` generated at connect time:
  - Compose string id: `"{username}@{host}:{port}#{seq}"`, where `seq` is
    per‑endpoint counter managed by a global registry (see Registry section).
  - Store in `SSHConnection` and surface via `SshConnectionInfo` record.
- Include the parent `connection_id` in `ShellSessionInfo` so shells are
  self‑describing.
- Keep return types as‑is:
  - `connect(...) -> Arc<SSHConnection>`
  - `SSHConnection.start_shell(...) -> Arc<ShellSession>`
  - Rationale: TS wrapper can attach convenience properties without losing the
    object pointer.

**Generated Bindings Impact**

- UniFFI TS will now include `SshConnectionInfo.connectionId` and
  `ShellSessionInfo.connectionId` fields.
- No breaking changes for existing methods.

**TypeScript API Changes (`packages/react-native-uniffi-russh/src/api.ts`)**

- Connect wrapper: augment the UniFFI object with an `id` property (string),
  from `await conn.info()`.
  - Do not spread; use
    `Object.defineProperty(conn, 'id', { value: info.connectionId, enumerable: true })`.
  - Keep the existing `startShell` wrapper pattern binding in place.
- StartShell wrapper: return a “hybrid” shell that exposes stable metadata as JS
  properties while preserving the UniFFI pointer.
  - After receiving `shell`, call `shell.info()` once.
  - Attach properties using `Object.defineProperty`:
    - `connectionId` (string), `channelId` (number), `sessionKey`
      (`${connectionId}:${channelId}`)
  - Optionally, add property accessors that forward to UniFFI methods for values
    that must stay live:
    - Example: `get pty() { return shell.pty(); }`
- New exported TS types:
  - `export type SshConnection = Generated.SshConnectionInterface & { id: string; startShell(...): Promise<SshShellSession> }`
  - `export type SshShellSession = Generated.ShellSessionInterface & { connectionId: string; channelId: number; sessionKey: string }`
- Helpers:
  - `parseSessionKey(key: string): { connectionId: string; channelId: number }`
  - `makeSessionKey(connectionId: string, channelId: number): string`

Details: replacing getters with JS properties

- Generated UniFFI classes expose methods like `createdAtMs()`, `pty()`, etc. We
  cannot change the generator output here.
- For fields that are static per instance (e.g., `id`, `channelId`,
  `connectionId`), attach JS value properties once with `Object.defineProperty`.
- For dynamic/queried fields, expose property accessors in the wrapper that call
  the underlying method:
  - `Object.defineProperty(conn, 'createdAtMs', { get: () => conn.createdAtMs(), enumerable: false })`
- Consumers use idiomatic properties, while the underlying UniFFI methods remain
  available.

**Registry and State Ownership**

- Rust already owns the actual connection/shell state. Exposing a public
  registry simplifies the app and supports deep‑linking.

Rust‑side registry (recommended)

- Maintain global registries with `lazy_static`/`once_cell`:
  - `CONNECTIONS: HashMap<String, Weak<SSHConnection>>` keyed by
    `connection_id`.
  - `SHELLS: HashMap<(String, u32), Weak<ShellSession>>` keyed by
    `(connection_id, channel_id)`.
- Assign `connection_id` deterministically at connect time using
  `username@host:port|created_at_ms`.
- Cleanup: when an `Arc` drops, entries are cleaned up opportunistically on
  `list*()` calls by removing dead `Weak`s.

New public UniFFI APIs

- `listSshConnections() -> Vec<SshConnectionInfo>`
- `getSshConnection(id: String) -> Arc<SSHConnection>`
- `listSshShellsForConnection(id: String) -> Vec<ShellSessionInfo>`
- `getSshShell(connection_id: String, channel_id: u32) -> Arc<ShellSession>`

Trade‑offs

- Pros: Single source of truth; app code is thinner; easy to navigate by id.
- Cons: Introduces global state; ensure thread safety and weak‑ref hygiene.

App Refactor (`apps/mobile`)

- State manager focuses on shells, not connections.
  - Map key: `sessionKey = \`${connectionId}:${channelId}\` (string)`
  - Value: `{ shell: SshShellSession, createdAt: Date }`
  - Derivable info: parent connection id, channel id.
- Index screen flow:
  1. `const conn = await RnRussh.connect(...)` → `conn.id` available.
  2. `const shell = await conn.startShell(...)` → `shell.connectionId` +
     `shell.channelId` available.
  3. Add to manager by `sessionKey` (no expo-crypto needed).
  4. Navigate to Shell screen with param `sessionKey`.
- Shell screen:
  - Accept `sessionKey` param.
  - Resolve to `SshShellSession` via manager; bind channel listener, decode
    bytes, send input via `shell.sendData(...)`.
  - On unmount, close shell and optionally disconnect parent connection if
    desired.

**Why not use channelId alone?**

- `channelId` is only meaningful within a single connection and changes per
  shell lifetime. It is not globally unique and can collide across TCP
  connections.
- `connectionId + channelId` is globally unique for the app session and stable
  for a shell’s lifetime.

**Should ShellSession hold a reference to parent SshConnection?**

- Rust already holds a Weak reference internally for lifecycle.
- Exposing a JS reference creates circular ownership concerns and accidental
  pinning of the connection.
- Recommendation: Do not expose the raw connection reference from ShellSession;
  instead, expose `connectionId` on `ShellSessionInfo`. When needed, resolve the
  connection via a registry using `connectionId`.

**Where should state live? (library vs app)**

- Option A: State in app (current approach)
  - Pros: Clear ownership, app controls lifecycle and persistence.
  - Cons: More glue code; each app must build its own registry.
- Option B: State in library (`@fressh/react-native-uniffi-russh`)
  - Library maintains registries: `listConnections()`, `getConnection(id)`,
    `listShells()`, `getShell(sessionKey)`.
  - Pros: Simple app code; easier deep‑linking.
  - Cons: Introduces implicit global state in the library; may complicate
    multiple RN roots/testing.
- Recommendation: Start with Option A (app‑owned manager) plus tiny helpers
  (make/parse sessionKey). Revisit Option B if multiple apps need shared
  behavior.

**Migration Plan (incremental)**

1. Rust
   - Add registry and `connection_id` assignment logic; extend
     `SshConnectionInfo` and `ShellSessionInfo`.
   - Add UniFFI exports: `listSshConnections`, `getSshConnection`,
     `listSshShellsForConnection`, `getSshShell`.
2. Re-generate UniFFI TS.
3. TS API (`api.ts`)
   - Augment `SshConnection` with `id` property (string) from `info()`.
   - Wrap `startShell` to attach `connectionId`, `channelId`, `sessionKey` and
     define property accessors.
   - Export helpers `makeSessionKey`/`parseSessionKey`.
4. App
   - Replace `ssh-connection-manager` to key by `sessionKey` and store
     `SshShellSession`, or consume library registry directly via new UniFFI
     APIs.
   - Remove expo-crypto dependency.
5. Optional
   - If desired, fully remove app‑side manager by relying on library registry
     methods for listing/lookup.

**Edge Cases & Notes**

- Multiple shells per connection: Supported via distinct `channelId`s; produce
  unique `sessionKey`s.
- Reconnecting: A new connection gets a new `connectionId`. Shells belong to
  that new id; old session keys become invalid.
- App restarts: In-memory ids reset; persisting them across restarts requires
  storing `connectionId` in app state if you plan to reconnect and restore.
- Types: If you prefer string ids everywhere in TS, convert the `u64` to a
  decimal string at the boundary.

**Open Questions (for later)**

- Should we add a library‑level registry as optional sugar? If yes, define clear
  lifecycle APIs (destroy on disconnect, eviction policy, etc.).
- Should we add a `ShellSession.id` separate from `channelId`? Not necessary
  now; `sessionKey` is sufficient and more descriptive.
