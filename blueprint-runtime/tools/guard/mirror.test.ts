/**
 * G6 测试镜像守卫的验证：故意造一个「源文件无同名测试」的临时树，断言被拦下。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingMirrors } from './mirror';

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bp-mirror-'));
  mkdirSync(join(root, 'core'), { recursive: true });
  return root;
}

describe('findMissingMirrors (G6)', () => {
  it('flags a source file that has no sibling test', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'core', 'orphan.ts'), 'export const x = 1;\n');
    expect(findMissingMirrors(root)).toContain('core/orphan.ts');
  });

  it('passes when every source has a sibling test', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'core', 'paired.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'core', 'paired.test.ts'), '// test\n');
    expect(findMissingMirrors(root)).toEqual([]);
  });
});
