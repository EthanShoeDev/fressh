# Future project: AI in the terminal — command suggestions + ask-the-shell

**Status:** NOT STARTED — exploratory. A "could we?" discussion doc, not a plan. It
records the idea, what's feasible given our architecture, the model-hosting tradeoff
(on-device vs. remote), the hard parts, and a phasing so we don't re-derive them.

**Scope (if pursued):** the mobile app's terminal UI + a new AI layer
(`apps/mobile`), the [`react-native-ai`](../../cloned-repos-as-docs/ai/README.md)
on-device toolkit (vendored as docs), and **Effect's AI package**
([`effect-smol/packages/ai`](../../cloned-repos-as-docs/effect-smol/packages/ai) +
the core `effect/unstable/ai` abstractions) as the provider-agnostic seam. Consumes —
does not modify — `@fressh/react-native-terminal`.

**Prerequisite:** [terminal-semantic-events.md](../complete/terminal-semantic-events.md). This is
the hard dependency, and the reason it's a prereq is below — an AI assistant is only as
good as the *shell context* it can see, and that context (cwd, command history, exit
codes, and the **boundaries that slice scrollback into "the last command's output"**)
is exactly what the semantic-events layer lifts out of the native byte stream into JS.
Without it we'd be guessing at context or scraping the whole screen.

## The idea

Two AI affordances on top of the terminal, both phone-shaped — things that earn their
keep precisely *because* you can't keep a second pane or a desktop copilot open:

1. **Command suggestion / autocomplete.** Given the shell context (cwd, recent
   commands, shell type, and the in-progress line), propose the next command or complete
   the current one — inline ghost-text the user can accept with a tap. Think Warp AI /
   Fig / `gh copilot suggest`, but native and on a phone keyboard where typing long
   commands is the actual pain.
2. **Ask a question, given the shell context.** A chat affordance: *"why did that
   fail?"*, *"what does this flag do?"*, *"how do I undo the last commit?"* The model
   sees the recent command(s), their **output** (error text included), the cwd, and
   optionally git status, and answers in a panel/sheet over the terminal.

The two differ in latency tolerance and context size, which is what drives the model
choice (below): (1) must feel instant and needs little context; (2) tolerates a
streamed multi-second answer and wants a fat, accurate context window.

## Why the semantic-events layer is the real prerequisite

An AI assistant needs to *read the terminal's meaning*, and our architecture
deliberately keeps the high-frequency byte stream native (never crosses to JS — see the
semantic-events doc §"data-flow problem"). So the facts the model needs aren't sitting
in a JS variable. The semantic-events pipeline is what makes them available:

| AI needs… | Comes from (semantic-events signal) |
| --------- | ----------------------------------- |
| which project / where am I | `OSC 7` → `WorkingDirectoryChanged` (cwd) |
| what just ran + did it work | `OSC 133 ; D ; <code>` → `CommandFinished` (cmdline + exit code) |
| **the output of the last command** (to explain a failure) | `OSC 133` A/B/C/D **region boundaries** — lets us extract *just* that command's output instead of dumping the whole screen |
| recent history for autocomplete | the stream of `CommandFinished` events |

That third row is the load-bearing one. "Explain this error" is useless if we can only
send the model a screen-grab of mixed prompt + output + half the previous command.
Command-region marking turns scrollback into addressable units ("stdout of the command
that exited 1"), which is both higher-signal and far cheaper in tokens. **Build the
semantic-events seam first; this feature is mostly a consumer of it plus a model call.**

> Caveat inherited from the prereq: all of this is gated on the remote shell having
> shell integration enabled (OSC 7 / OSC 133). Same constraint as every smart-terminal
> feature; same degrade-silently / offer-to-install-a-hook story. See that doc.

The one signal the prereq doesn't cleanly give us is the **in-progress (un-submitted)
line** that autocomplete needs *before* the user hits enter. Options: (a) JS already
knows the bytes it forwards to the PTY, so it can track the current line itself (messy
with history/line-editing/multiline); (b) a lighter native "current prompt buffer"
signal. This is an open question (below), and a reason Feature 2 (which only needs
*finished* commands) is the easier first target.

## Where the AI runs: on-device vs. remote (the core tradeoff)

The interesting design decision is *not* the UI — it's where inference happens. Both
are viable and they have opposite profiles. We should build the feature logic **once**
against a provider-agnostic interface and let the backend be swappable.

### The seam: Effect's `LanguageModel`

We standardize on **Effect's AI abstraction** — `LanguageModel` from
`effect/unstable/ai`. Feature code calls `LanguageModel.generateText` /
`LanguageModel.streamText` / `LanguageModel.generateObject` against the `LanguageModel`
service; *which model* answers is decided by the layer we provide. "On-device vs.
remote" becomes a choice of layer, not a fork in the feature code.

Why this and not the Vercel AI SDK: the mobile app is already **Effect v4** end-to-end
(we dropped zod→`Schema` and tanstack-query→effect-atom). Effect AI keeps inference in
the *same* runtime — Schema-typed structured output (matches our zod→Schema move),
Effect-native streaming, `Toolkit`/`Tool` for tool use, error channels, and
cancellation that composes with the rest of the app. The Vercel AI SDK would bolt a
second, parallel async system onto an Effect codebase.

**Remote providers ship in the package** (`effect-smol/packages/ai`):
`@effect/ai-anthropic` (`AnthropicLanguageModel.model(...)` / `.layer(...)`),
plus `@effect/ai-openai`, `@effect/ai-openrouter`, and `openai-compat`. Each `.model(id)`
yields a `LanguageModel` you provide to the calls above. Swap the provider layer → the
feature code is untouched.

**On-device has no provider in that set** — they're all hosted. Two ways to put a local
model behind the same seam: (a) a thin **custom `LanguageModel` layer** (`LanguageModel.make({...})`)
wrapping `react-native-ai`'s generate/stream calls; or (b) point **`openai-compat`** at
a local OpenAI-compatible endpoint (a `llama.cpp`/MLC server on-device). Either way the
feature talks only to `LanguageModel`. The custom-layer adapter is the open question
that makes on-device more than a config toggle (see Open questions).

### Option A — on-device (privacy-first default)

Via `react-native-ai`:
- **Apple Foundation Models** (`@react-native-ai/apple`) — built-in, no download,
  autolinked. **iOS 26+ and an Apple-Intelligence-capable device only.**
- **Llama** (`@react-native-ai/llama`, GGUF) or **MLC** — cross-platform incl. Android,
  but require a **multi-GB model download** and meaningful RAM.

Pros: private (shell context never leaves the phone — see Security), offline, zero
per-call cost. Cons: weakest models, iOS-version / device gated for the no-download
path, big downloads + memory pressure otherwise, slower on older hardware. Good fit for
Feature 1 (small context, latency-sensitive, and the *most* privacy-sensitive since the
in-progress line may contain secrets).

### Option B — remote, bring-your-own-key (capability-first)

User supplies their own API key; we call a hosted model via `@effect/ai-anthropic`
(`AnthropicLanguageModel.model(...)`). Sensible tiers (IDs/prices current as of
writing):

| Model | ID | Context | $/1M in | $/1M out | Use for |
| ----- | -- | ------- | ------- | -------- | ------- |
| Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 | $5 | fast autocomplete, cheap |
| Sonnet 4.6 | `claude-sonnet-4-6` | 1M | $3 | $15 | balanced Q&A |
| Opus 4.8 | `claude-opus-4-8` | 1M | $5 | $25 | hardest "why did this break" |

Use **streaming** for the Q&A answer (it's the natural UX and avoids request timeouts)
and **adaptive thinking** (`thinking: {type: "adaptive"}`) for the harder questions.

Pros: far more capable, no device gating, no local download. Cons: needs network, costs
the user per call, and — the big one — **sends shell context off the device.**

**Recommendation:** ship on-device as the default and privacy story, expose remote
BYOK as an opt-in power-user upgrade. Because both sit behind `LanguageModel`, the
*feature* code is one codebase — the cost is the on-device adapter layer, not a second
implementation of autocomplete/Q&A.

### Rolling our own on-device `LanguageModel` provider

There's no Effect AI provider for on-device models, but writing one is small **for the
text-generation scope we need** — confirmed against both sides' contracts.

**The Effect contract** is just two functions (`LanguageModel.make`,
`packages/effect/src/unstable/ai/LanguageModel.ts`):

```ts
LanguageModel.make({
  generateText: (opts: ProviderOptions) => Effect<Array<Response.PartEncoded>, AiError, IdGenerator>
  streamText:   (opts: ProviderOptions) => Stream<Response.StreamPartEncoded, AiError, IdGenerator>
  codecTransformer?: ...   // structured output only — skip for v1
})
```

`ProviderOptions` gives us `prompt: Prompt.Prompt`, `tools`, `toolChoice`,
`responseFormat`, `span`. We emit `Response.Part`s — for streaming, essentially
`TextStart → TextDelta* → TextEnd → Finish`. That's the whole interface. What makes the
built-in providers large (`@effect/ai-anthropic` is ~19k lines) is wire-schema +
tool-calling + structured-output mapping — the top-level `make` impl there is ~10 lines
per method. Our adapter is two mapping functions, not a port of that.

**`react-native-ai` exposes two entry points → two adapter strategies:**

- **(A) Target the native modules directly** — `AppleFoundationModels` /
  `generateStream` (apple-llm), and the llama/mlc native modules. Map `Prompt` → native
  input, wrap the native event stream into an Effect `Stream` of `Response.Part`s.
  Skips the Vercel AI SDK entirely; **decouples us from AI-SDK versioning** — the likely
  cleaner fit for an Effect codebase.
- **(B) Wrap their AI-SDK model object** — their `apple()`/`llama`/`mlc` providers
  implement the Vercel AI SDK `LanguageModelV3` spec (`doGenerate`/`doStream` over
  `LanguageModelV3CallOptions`). Translate `ProviderOptions ↔ LanguageModelV3CallOptions`
  and the stream parts both ways. More translation surface (two abstractions), but
  inherits their prompt templating. Pins us to their `specificationVersion = 'v3'`.

A third path — point **`openai-compat`** at a local OpenAI-compatible `llama.cpp`/MLC
server — works too, but adds a local server process; prefer (A)/(B) for a library-only
integration.

**What's actually fiddly** (not the mapping): bridging the native event stream into an
*interruptible* Effect `Stream` with errors mapped to `AiError`. Same native-event
bridging shape the app already does on the terminal side, so not new territory. **Tool
use and structured output are what balloon an adapter — defer both;** v1 text answers
need neither.

## Architecture (consumer of existing seams)

Nothing structural is new on the data plane — we reuse the pipes the other docs
describe:

1. **Context assembly (JS).** A small module subscribes to `addFresshEventListener`
   (`src/ssh.ts`) and maintains per-`shellId` rolling context in `ssh-store.ts`: cwd,
   last N commands + exit codes, and the sliced output of the most recent command(s).
   This is the same per-shell state the git doc proposes — likely the same store.
2. **Prompt builder.** Turns that context into a compact prompt (redacted — see
   Security). Keep it small for on-device; it can be richer for remote.
3. **Inference call.** `LanguageModel.generateText` (autocomplete) /
   `LanguageModel.streamText` (Q&A), with the selected provider layer supplied. Use
   `Schema`-typed structured output where the result needs shape (e.g. a suggestion
   object with a `destructive` flag).
4. **UI overlay.** Both surfaces are React overlays floated over the native terminal —
   the *exact* pattern already used for the copy button and the modifier-key toolbar in
   `apps/mobile/src/app/(tabs)/servers/terminal.tsx`. Per
   [smart-terminal-surface.md](../smart-terminal-surface.md): **"Ask AI" is a button on
   toolbar page 3** opening a **bottom sheet** that streams the answer; autocomplete =
   inline ghost text near the prompt. No renderer work.
5. **Acceptance path.** Accepting a suggestion just writes the bytes to the PTY through
   the same input path the keyboard already uses. The model never executes anything —
   it proposes; the user submits.

## Suggested phasing

- **v0 (proof, remote, manual):** A "?" button on the terminal → bundle {cwd, last
  command, its output} → one streamed Q&A answer in a sheet, via remote BYOK. Validates
  context assembly + the overlay with zero on-device/model-download work. Requires the
  OSC-133 region slice from the prereq (or, to prove UI sooner, a crude "last screen"
  grab, honestly labelled).
- **v1 (on-device + the seam):** Put both providers behind the AI SDK; add the
  on-device default (Apple Foundation Models on iOS, with a download path for the rest)
  and the provider toggle in settings. Q&A works fully offline on capable devices.
- **v2 (autocomplete):** Solve the in-progress-line signal, add inline ghost-text
  suggestions (latency-sensitive → on-device/Haiku), accept-on-tap.
- **v3 (richer context):** Fold in git status (ties into
  [git-diff-integration.md](git-diff-integration.md)) and multi-command history for
  better "what should I do next" suggestions.

## Open questions

- **The in-progress line.** Autocomplete needs the un-submitted prompt buffer. Track it
  in JS from forwarded bytes (handle backspace/history/multiline), or add a native
  signal? This is the biggest unknown for Feature 1 and the reason Feature 2 lands
  first.
- **Context window vs. token cost.** How many commands / how much output do we send?
  On-device wants tiny; remote can afford more but the user pays. Need a budget + a
  "slice to the relevant command region" strategy (cheap thanks to the prereq).
- **On-device gating.** Apple Foundation Models need iOS 26+; everything else needs a
  multi-GB download and RAM. What's the UX for "your device can't run this locally —
  download a model, or use a remote key"? Don't make the feature feel broken on older
  or Android devices.
- **Latency for autocomplete.** Even on-device, a small model on older hardware may be
  too slow for inline suggestions. Debounce, cancel-on-keystroke, and a quality bar for
  *when* to even show a suggestion.
- **On-device adapter.** The Effect AI providers are all remote; the on-device path
  needs a custom `LanguageModel` provider — see *Rolling our own on-device
  `LanguageModel` provider* above. Open: pick strategy (A) native-direct vs. (B) wrap
  their AI-SDK V3 object, and prove interruptible streaming under Effect. This is the
  main build cost of the on-device path. (`effect/unstable/ai` is still under
  `unstable` — the API may shift; pin deliberately, consistent with our dep-lock
  discipline.)
- **Trust boundary on suggestions.** The model proposes commands the user runs on a
  real host. We never auto-execute, but a confidently-wrong `rm`/`git reset --hard`
  suggestion is dangerous. Consider flagging destructive verbs before insertion.

## Security & privacy (the headline concern)

This feature reads the **contents of the user's shell** — commands, output, hostnames,
and potentially **secrets** (tokens echoed, env dumps, connection strings, key
material). That makes the model-hosting choice a privacy decision, not just a capability
one:

- **On-device** is the privacy-preserving path: context never leaves the phone. This is
  why it's the default, and especially why latency-sensitive *autocomplete* (which sees
  the in-progress line, the most secret-prone surface) should prefer it.
- **Remote** means shell context is **transmitted to a third party** and may be retained
  per that provider's policy. This requires (a) **explicit, informed opt-in** with a
  clear statement of what's sent where, (b) BYOK so it's the user's own account/policy,
  and (c) a **redaction pass** in the prompt builder (strip obvious secret patterns —
  tokens, `Authorization:` headers, private keys, `.env`-shaped lines) before anything
  leaves the device. Never silently default a user into sending their terminal to a
  cloud.
- The model is **advisory only** — it proposes text into the input line; it never
  executes. The user always submits explicitly.

## Reference

- The provider-agnostic seam — Effect AI providers (`anthropic`, `openai`, `openrouter`,
  `openai-compat`): [`docs/cloned-repos-as-docs/effect-smol/packages/ai`](../../cloned-repos-as-docs/effect-smol/packages/ai);
  core abstractions (`LanguageModel`, `Chat`, `Tool`, `Toolkit`, `Prompt`, `Response`)
  in `effect/unstable/ai`.
- On-device toolkit + provider matrix (Apple / Llama / MLC) and usage examples:
  [`docs/cloned-repos-as-docs/ai/README.md`](../../cloned-repos-as-docs/ai/README.md).
- The context source this all depends on: [terminal-semantic-events.md](../complete/terminal-semantic-events.md).
- A sibling consumer of the same per-shell context: [git-diff-integration.md](git-diff-integration.md).
