# uniffi-russh

UniFFI bindings around [`russh`](https://github.com/Eugeny/russh), designed to make a **safe, async SSH client** usable from JavaScript/TypeScript — especially **React Native (Hermes/JSI)** — while staying close to russh’s model.

This crate hosts the Rust code and UniFFI exports; the React Native module that consumes it lives in `@fressh/react-native-uniffi-russh`.

---

## Why this exists

* The React Native SSH landscape is thin and often not truly async.
* We want a **thin, principled wrapper** over russh that:

  * exposes **connection + channel (shell) primitives**;
  * streams **binary data chunks** (stdout/stderr) to JS;
  * reports **connection state transitions** (TCP and shell);
  * provides **keypair generation** via `russh-keys`;
  * compiles cleanly for **Android (NDK)** and other targets with **Tokio**.

---

## High-level design

* **Rust core** (this crate): Tokio-based client using `russh` and `russh-keys`. Exposes functions/objects via UniFFI macros.
* **FFI surface** (stable across languages):

  * `connect(details, connect_status_listener?) -> SSHConnection`
  * `SSHConnection.start_shell(pty, shell_status_listener?) -> channel_id`
  * `SSHConnection.send_data(bytes)`
  * `SSHConnection.exec(command)`
  * `SSHConnection.close_shell()`
  * `SSHConnection.disconnect()`
  * `generate_key_pair(key_type) -> String (OpenSSH PEM)`
* **Events**:

  * `connect_status_listener`: `TcpConnecting` → `TcpConnected` → `TcpDisconnected`
  * `shell_status_listener`: `ShellConnecting` → `ShellConnected` → `ShellDisconnected`
* **Streaming**:

  * Register multiple `ChannelListener`s with `SSHConnection.add_channel_listener/remove_channel_listener`.
  * Each listener gets `on_data(Vec<u8>)` for stdout/stderr frames (no OSC parsing; renderer decides).

We intentionally keep **shell start** separate from **connect** so app UIs can render intermediate states and so advanced consumers can open multiple channels.

---

## What’s exported (conceptual API)

### Records & Enums

```rust
// Authentication choice
enum Security {
  Password { password: String },
  Key { key_id: String }, // (planned for auth; keygen is available)
}

// Connection details
record ConnectionDetails {
  host: String,
  port: u16,
  username: String,
  security: Security,
}

// Status events
enum SSHConnectionStatus {
  TcpConnecting,
  TcpConnected,
  TcpDisconnected,
  ShellConnecting,
  ShellConnected,
  ShellDisconnected,
}

// PTY selection (maps to SSH pty term names)
enum PtyType { Vanilla, Vt100, Vt102, Vt220, Ansi, Xterm }

// Key generation
enum KeyType { Rsa, Ecdsa, Ed25519, Ed448 /* unsupported */ }
```

### Objects & Traits

```rust
// Rust -> JS callback traits
trait StatusListener { fn on_status_change(status: SSHConnectionStatus); }
trait ChannelListener { fn on_data(data: Vec<u8>); }

// Main connection object
object SSHConnection {
  // read-only getters
  fn connection_details() -> ConnectionDetails;
  fn created_at_ms() -> f64;
  fn tcp_established_at_ms() -> f64;

  // channel streaming
  fn add_channel_listener(listener: Arc<dyn ChannelListener>);
  fn remove_channel_listener(listener: Arc<dyn ChannelListener>);

  // shell lifecycle (optional; call only if you want a shell)
  async fn start_shell(pty: PtyType, shell_status: Option<Arc<dyn StatusListener>>) -> u32; // channel_id
  async fn close_shell();

  // writing
  async fn send_data(bytes: Vec<u8>);
  async fn exec(command: String);

  // connection lifecycle
  async fn disconnect();
}

// top-level
async fn connect(details: ConnectionDetails, connect_status: Option<Arc<dyn StatusListener>>)
  -> Arc<SSHConnection>;

async fn generate_key_pair(key_type: KeyType) -> String; // OpenSSH PEM
```

### Error model

All fallible functions return `Result<_, SshError>`. We map errors from `russh`, `russh-keys`, `ssh-key`, and `std::io` into a single enum that UniFFI can surface to JS.

---

## React Native (TypeScript) usage

> This assumes you’re using the companion package `@fressh/react-native-uniffi-russh` which wires this crate through UniFFI + JSI for React Native.

```ts
import {
  connect,
  generateKeyPair,
  PtyType,
  type ConnectionDetails,
  type SSHConnectionStatus,
  type SSHConnection,
} from '@fressh/react-native-uniffi-russh';

const details: ConnectionDetails = {
  host: 'example.com',
  port: 22,
  username: 'me',
  security: { Password: { password: 'secret' } },
};

const connStatus = {
  on_status_change(status: SSHConnectionStatus) {
    console.log('connect status:', status);
  },
};

const shellStatus = {
  on_status_change(status: SSHConnectionStatus) {
    console.log('shell status:', status);
  },
};

const channelListener = {
  on_data(data: Uint8Array) {
    // bytes → feed your terminal emulator / decoder
    console.log('got', data.length, 'bytes');
  },
};

(async () => {
  const conn: SSHConnection = await connect(details, connStatus);

  // streaming callbacks
  conn.add_channel_listener(channelListener);

  // optionally start a shell
  const chanId = await conn.start_shell(PtyType.Xterm, shellStatus);
  console.log('shell channel id', chanId);

  // write to the shell
  await conn.send_data(new TextEncoder().encode('echo hello\n'));

  // or run a one-shot exec request
  await conn.exec('uname -a');

  // later…
  await conn.close_shell();
  await conn.disconnect();
})();
```

Key generation:

```ts
const pem = await generateKeyPair('Ed25519'); // string (OpenSSH format)
```

> **Note:** For now, *password* authentication is implemented. Public-key auth is on the roadmap. Key generation works today.

---

## Building & platforms

* **Tokio** runtime (multi-thread) is used for all async.
* This crate is meant to be consumed via **UniFFI**:

  * For React Native, we use `uniffi-bindgen-react-native` (UBRN) to generate the TypeScript/JS glue and JSI/Hermes bindings.
* **Android:** Requires NDK; our `russh` dependency is configured to use the `ring` crypto backend (no CMake-heavy `aws-lc`).
* **iOS / Desktop:** The core crate is platform-agnostic; UBRN/JSI wiring is what determines where you can use it from JS.

---

## Staying close to russh

We intentionally keep the shape near russh’s primitives:

* **Connect** returns a `SSHConnection` backed by a `russh::client::Handle`.
* **Shell** is an **optional channel** you can start on demand (`start_shell`), with a PTY term (e.g., `xterm-256color`).
* **Multiple channels** are possible (russh supports it). The exported surface focuses on the **typical single shell** flow. Advanced multiplexing is a natural extension.

What we **don’t** do here:

* Terminal emulation or OSC parsing (leave that to your renderer).
* SFTP (out of scope for this crate).
* Key agent / forwarding / port forwarding (not yet).

---

## Feature flags / deps (summary)

* `tokio` (rt-multi-thread, macros, time, net, sync)
* `russh` with the **`ring`** crypto backend (to avoid `aws-lc-sys`/CMake churn on Android)
* `russh-keys` for key handling + PEM export
* `thiserror` for error ergonomics
* `rand` (keygen), `bytes`, `futures`, `once_cell` as needed
* `uniffi`/`uniffi_macros` for the FFI surface

---

## Roadmap

* Public key authentication (using `russh-keys` and server’s supported hash algs)
* Channel multiplexing helpers (e.g., open arbitrary exec channels alongside shell)
* Port forwarding
* Optional OSC133-ish event surfacing (if we later add a parser utility crate)
* SFTP (in a separate crate)

---

## Contributing

We aim for:

* **Predictable FFI surface** (stable enums/records)
* **Tokio-friendly** code (no blocking in async)
* **Clippy-clean** builds (`-D warnings`)
* **Thin abstraction** over russh (no surprises)

PRs welcome — especially improvements to error mapping and additional authentication modes.

---

## License

Same as russh unless otherwise noted in this repository. (Check the repo root for the definitive license file.)
