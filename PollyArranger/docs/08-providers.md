# 08 — Providers (multi-vendor reference)

> Polly is vendor-neutral by design ([04-agent-adapters.md](04-agent-adapters.md)).
> This doc is the concrete reference: which providers exist, how each is wired,
> and the environment/config they need. It's the "lookup table" you reach for
> when adding or switching a vendor.

---

## 1. The two backend kinds (recap)

- **Coding-agent harnesses** (Claude Code, Codex CLI, Cursor, OpenClaude): already
  agentic; the adapter hands them a task + working dir.
- **Raw LLM APIs** (DeepSeek, OpenAI, MiniMax, Kimi, Qwen, GLM): just endpoints.
  - As a **reviewer**: a single chat-completion call → `verdict`. Easy.
  - As an **implementer**: needs a tool-calling agent loop to edit files. Medium.

See [04 §3](04-agent-adapters.md) for the full discussion.

---

## 2. Provider table

| Vendor key | Family | Backend kind | How wired | Reviewer | Implementer | Auth env |
|------------|--------|--------------|-----------|:--------:|:-----------:|----------|
| `deepseek` | deepseek | raw API (OpenAI-compatible) | `openai-compatible` adapter | ✅ easy | ✅ **live-verified** | `DEEPSEEK_API_KEY` |
| `openai` | openai | raw API | `openai-compatible` adapter | ✅ | ✅ | `OPENAI_API_KEY` |
| `minimax` | minimax | raw API (verify format) | `openai-compatible` adapter* | ✅ | ✅ | `MINIMAX_API_KEY` |
| `kimi` (Moonshot) | kimi | raw API (OpenAI-compatible) | `openai-compatible` adapter | ✅ | ✅ | `MOONSHOT_API_KEY` |
| `qwen` (Alibaba) | qwen | raw API (OpenAI-compatible mode) | `openai-compatible` adapter | ✅ **live-verified** | ✅ | `DASHSCOPE_API_KEY` |
| `glm` (Zhipu) | glm | raw API (OpenAI-compatible) | `openai-compatible` adapter | ✅ | ✅ | `ZHIPU_API_KEY` |
| `openrouter` | (per model) | aggregator (OpenAI-compatible) | `openai-compatible` adapter | ✅ | ✅ | `OPENROUTER_API_KEY` |
| `claude_code` | anthropic | harness (CLI) | `claude -p` subprocess (`adapters/harness.mjs`) | ✅ | ✅ | **none — CLI's own auth** |
| `codex` | openai | harness (CLI) | `codex exec` subprocess (`adapters/harness.mjs`) | ✅ | ✅ | **none — CLI's own auth** |
| `cursor` | cursor | harness (CLI) | Cursor agent subprocess | ✅ | ✅ | per CLI auth |
| `openclaude` | anthropic | harness | OpenClaude subprocess | ✅ | ✅ | per harness auth |

\* MiniMax has historically used its own request/tool-call shape; confirm
OpenAI-compatibility for the chosen model before relying on the generic adapter.

> **Family matters.** `assignRoles()` prefers a reviewer from a *different
> family* than the implementer ([04 §4](04-agent-adapters.md)). Two `openai`-family
> vendors (e.g. `openai` + `codex`) reviewing each other is weaker than
> `deepseek` ↔ `openai`. Keep the `family` field accurate.

---

## 3. Example config shape

Providers are described by a small config record. (Final config location is a
Phase 2 decision; shape shown here.)

```js
const PROVIDERS = {
  deepseek: {
    baseURL: 'https://api.deepseek.com',   // OpenAI-compatible
    model:   'deepseek-chat',              // or 'deepseek-reasoner'
    keyEnv:  'DEEPSEEK_API_KEY',
    family:  'deepseek',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model:   'gpt-...',
    keyEnv:  'OPENAI_API_KEY',
    family:  'openai',
  },
  // minimax, kimi, qwen, glm, openrouter … same shape
};
```

The `openai-compatible` adapter reads one of these, reads the key from
`process.env[keyEnv]`, and exposes Polly's standard `implement()` / `review()`.

---

## 4. Dev/debug posture: DeepSeek first

**Decision (2026-06-24):** develop and debug against **DeepSeek**.

- Claude keys are harder to get and much more expensive — wrong tool for the many
  iterations of building the loop.
- DeepSeek is cheap, easy to sign up for, OpenAI-compatible, supports tool calling.

So the first real adapter (Phase 2) is DeepSeek via `openai-compatible`. Premium
vendors (Claude, etc.) are config-only additions once the loop is proven cheaply.

A natural early cross-vendor pairing for testing real review:
**implementer `deepseek` ↔ reviewer `openai`** (or `kimi`/`glm`) — two different
families, both cheap.

---

## 4b. Harness vendors (Claude Code / Codex) — no key required

`claude_code` and `codex` are **installed agent CLIs**, not raw APIs. The harness
adapter (`src/adapters/harness.mjs`) spawns the CLI as a subprocess and **passes no
key** — the CLI uses whatever auth it was set up with (company SSO, a managed key,
Bedrock…). So a harness vendor works even when you cannot obtain a key yourself.

- **Pairing:** the work machine has `claude`, the home machine has `codex`; they're
  never together. Pair the harness vendor with a cheap API vendor of a different
  family, e.g. `--vendors claude_code,deepseek` (work) or `--vendors codex,deepseek`
  (home). Both are genuine cross-vendor.
- **Resume (⑤):** claude uses native `--session-id`/`--resume`; codex soft-resumes
  via the worktree.
- **Per-machine verification (do this once on each machine):** run a small real task
  and confirm the CLI's headless mode works — the **workspace-trust prompt** and the
  **permission flags** are the things that vary:
  - claude: `claude -p --output-format json --permission-mode acceptEdits` (the
    adapter's default). If a new worktree triggers a trust dialog, pre-accept it.
  - codex: `codex exec "<task>"` (verify the exact non-interactive flag for your
    version).
  - Tune via the factory `harness` overrides (`command`, `shell`, custom `preset`)
    if your install needs e.g. `claude.cmd` on Windows or `--dangerously-skip-permissions`.

## 5. Adding a new provider (checklist)

1. Add a `family` entry in `DEFAULT_FAMILIES` (`src/state-machine.mjs`).
2. Add a `PROVIDERS` config record (base URL + model + key env + family).
3. If OpenAI-compatible: nothing else — the `openai-compatible` adapter covers it.
   If not: write a thin adapter that maps the vendor's format to
   `AgentResult` / `ReviewResult`.
4. Verify end-to-end with a real `review()` call (cheap) before trusting
   `implement()`.
5. Add it to a registry's `vendors` list so `assignRoles()` can pick it.

No changes to `orchestrator.mjs` or the state machine are ever needed — that's the
whole point of the adapter seam.
