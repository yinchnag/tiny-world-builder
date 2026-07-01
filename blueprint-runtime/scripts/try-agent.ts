/**
 * ─────────────────────────────────────────────────────────────
 * 手动试跑：用真 env key 跑一次 Agent 执行器，验证真推理。
 * 非 CI（需网络 + API key）；tsx 直跑，不进 vitest/护栏门禁。
 *
 * 用法（PowerShell）：
 *   $env:DEEPSEEK_API_KEY="sk-xxx";  pnpm try:agent deepseek
 *   $env:DASHSCOPE_API_KEY="sk-xxx"; pnpm try:agent qwen
 *   $env:OPENAI_API_KEY="sk-xxx";    pnpm try:agent openai gpt-4o-mini
 * 用法（bash）：
 *   DEEPSEEK_API_KEY=sk-xxx pnpm try:agent deepseek
 * 第 1 参=供应商名，第 2 参（可选）=model（缺省取该供应商默认）。
 *
 * 走的是和 CI 一样的 createAgentExecutor + resolveProvider，只把 mock 换成 env 真 key——
 * 即"运行一个通过工作流搭建的 Agent"的真实版（这里直接喂一段 context + 一个问题）。
 * ─────────────────────────────────────────────────────────────
 */
import { createAgentExecutor } from '../runtime/engine/exec/agent';
import { resolveProvider, PROVIDERS, defaultModelFor } from '../runtime/engine/exec/providers/registry';
import { fixedClock } from '../runtime/kernel/clock';

async function main(): Promise<void> {
  const providerName = process.argv[2] ?? 'deepseek';
  const cfg = PROVIDERS[providerName];
  if (cfg === undefined) {
    console.error(`未知供应商 "${providerName}"。可选：${Object.keys(PROVIDERS).join(' / ')}`);
    process.exit(1);
  }
  if ((process.env[cfg.apiKeyEnv] ?? '') === '') {
    console.error(`缺少环境变量 ${cfg.apiKeyEnv}。先设置：  $env:${cfg.apiKeyEnv}="你的key"  再跑。`);
    process.exit(1);
  }
  const model = process.argv[3] ?? defaultModelFor(providerName) ?? '';

  const exec = createAgentExecutor((name) => resolveProvider(name, process.env));
  console.log(`▶ provider=${providerName} model=${model} —— 真实调用中…`);

  const result = await exec({
    node: {
      id: 'A',
      type: 'agent',
      state: 'working',
      properties: { provider: providerName, model, systemPrompt: '你是一个简洁的中文助手。' },
    },
    inputs: {
      context_in: [{ items: ['Blueprint 是一个蓝图式图编辑器 + 图运行时项目。'] }],
      message_in: [{ text: '用一句话介绍这个项目。' }],
    },
    clock: fixedClock(new Date().toISOString()),
  });

  const report = result.outputs.find((o) => o.port === 'report_out');
  const summary = (report?.payload as { summary?: string } | undefined)?.summary;
  console.log('◀ AgentReport.summary:\n' + (summary ?? '(空——检查 key/model/网络)'));
  console.log(`◀ 状态推进 → ${result.nextState ?? '(无)'}`);
}

main().catch((err: unknown) => {
  console.error('试跑失败：', err);
  process.exit(1);
});
