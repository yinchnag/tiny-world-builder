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
- **Tuning without code edits:** the CLI exposes three harness flags so you adapt
  to a machine from the command line:
  - `--harness-command <c>` — e.g. `--harness-command codex.cmd` on Windows
  - `--harness-shell` — spawn via a shell (needed to run a `.cmd` on Windows)
  - `--harness-stdin` — send the prompt via stdin instead of an arg (dodges shell quoting)

### Per-machine verification checklist (≈10 min each, not a dev session)

Run `npm test` first (all offline — proves the harness mechanism). Then one real
smoke per machine against a throwaway repo:

```bash
npm run polly -- run --repo <tmp-repo> --spec "Create hello.mjs exporting hi()" \
  --vendors codex,deepseek --local-pr --merge auto --gates "node --version"
```

1. **Check the CLI's headless interface once:** `codex --help` (and `codex exec --help`).
   Confirm the non-interactive subcommand is `exec`, and note whether it can read the
   prompt from **stdin** and whether it prints clean output.
2. **macOS (codex):** the default usually works as-is — `codex` is on PATH and
   `shell:false` passes the prompt as a clean arg (no quoting issues). If `codex`
   isn't found, add `--harness-command "$(command -v codex)"`.
3. **Windows (codex):** `codex` is typically a `.cmd` shim, which Node can't spawn
   without a shell. Use:
   `--harness-shell --harness-stdin` (shell finds `codex.cmd`; stdin avoids the shell
   mangling a multi-line prompt). If the command name differs, add
   `--harness-command codex.cmd`. **Only works if `codex exec` reads stdin** — if step 1
   says it doesn't, tell me and I'll add a temp-file prompt mode.
4. **claude (work machine):** default is `claude -p --output-format json
   --permission-mode acceptEdits`. If a fresh worktree pops a **workspace-trust**
   dialog, pre-accept it (or we add the right flag once you see the prompt).
5. **Confirm the review verdict parses:** the reviewer must end with a
   `POLLY_VERDICT: …` line. Real models follow the instruction reliably; if a CLI
   wraps output in extra chrome, the marker regex still finds it.

If something doesn't line up, capture the exact `--help` output + the error and we
adjust the preset/flags — no core changes needed.

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
