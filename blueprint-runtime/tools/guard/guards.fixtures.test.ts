/**
 * F-guard 验收 #2：故意违规夹具被对应护栏逐项拦下（无漏报）。
 *
 * 用 ESLint 的 lintText API 把「假文件」按其 filePath 套用项目 flat config，
 * 断言对应 rule 报错——夹具不落盘，因此不污染正常 `eslint .` 闸。
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint();

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((r) => r.messages.map((m) => m.ruleId ?? ''));
}

describe('guards catch deliberate violations (F-guard #2)', () => {
  it('G2 max-lines: a 600-line file', async () => {
    const code = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`).join('\n') + '\n';
    expect(await ruleIdsFor('core/__fix__/big.ts', code)).toContain('max-lines');
  });

  it('G2 max-lines-per-function: a 137-line function', async () => {
    const body = Array.from({ length: 137 }, () => '  void 0;').join('\n');
    const code = `/**\n * doc\n * @returns nothing\n */\nexport function f(): void {\n${body}\n}\n`;
    expect(await ruleIdsFor('core/__fix__/longfn.ts', code)).toContain('max-lines-per-function');
  });

  it('G5 require-jsdoc: an exported function without JSDoc', async () => {
    const code = 'export function bare(): number { return 1; }\n';
    expect(await ruleIdsFor('core/__fix__/nodoc.ts', code)).toContain('jsdoc/require-jsdoc');
  });

  it('G1/R2 core purity: core importing node:*', async () => {
    const code = "import { readFileSync } from 'node:fs';\nexport const v = readFileSync;\n";
    expect(await ruleIdsFor('core/__fix__/nodeimp.ts', code)).toContain('no-restricted-imports');
  });

  it('G1/R3 front-back: editor importing runtime', async () => {
    const code = "import { x } from '../../../runtime/mcp/transport';\nexport const y = x;\n";
    expect(await ruleIdsFor('editor/src/sync/badimport.ts', code)).toContain('no-restricted-imports');
  });
});
