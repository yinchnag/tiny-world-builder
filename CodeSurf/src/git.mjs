import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { CodeSurfError } from './errors.mjs';

const execFileAsync = promisify(execFile);

async function git(repoPath, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message = err?.stderr || err?.stdout || err?.message || String(err);
    throw new CodeSurfError('CODESURF_GIT_ERROR', message.trim());
  }
}

function parseStatusLine(line) {
  if (!line || line.startsWith('## ')) return null;
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const renamed = rawPath.includes(' -> ');
  const [from, to] = renamed ? rawPath.split(' -> ') : ['', rawPath];
  return {
    status,
    path: to,
    ...(from ? { from } : {}),
    staged: status[0] !== ' ' && status[0] !== '?',
    unstaged: status[1] !== ' ',
    untracked: status === '??',
  };
}

function parseBranchLine(line) {
  const body = line.replace(/^##\s+/, '');
  const ahead = Number((body.match(/\[.*ahead (\d+)/) || [])[1] || 0);
  const behind = Number((body.match(/\[.*behind (\d+)/) || [])[1] || 0);
  const name = body.split('...')[0].split(' ')[0] || '';
  return { name, ahead, behind, protected: ['main', 'master', 'production'].includes(name) };
}

function parseWorktrees(text) {
  const out = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (current) out.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') current = { path: value };
    else if (current && key === 'HEAD') current.head = value;
    else if (current && key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (current && key === 'detached') current.detached = true;
    else if (current && key === 'bare') current.bare = true;
  }
  if (current) out.push(current);
  return out;
}

export async function gitStatus(repositoryPath) {
  const [statusText, topLevel, diffStat, worktreeText] = await Promise.all([
    git(repositoryPath, ['status', '--short', '--branch']),
    git(repositoryPath, ['rev-parse', '--show-toplevel']),
    git(repositoryPath, ['diff', '--shortstat']).catch(() => ''),
    git(repositoryPath, ['worktree', 'list', '--porcelain']).catch(() => ''),
  ]);
  const lines = statusText.trimEnd().split(/\r?\n/);
  const branch = parseBranchLine(lines.find((line) => line.startsWith('## ')) || '## unknown');
  const files = lines.map(parseStatusLine).filter(Boolean);
  return {
    repositoryPath,
    topLevel: topLevel.trim(),
    branch,
    dirty: files.length > 0,
    files,
    diffStat: diffStat.trim(),
    worktrees: parseWorktrees(worktreeText),
  };
}

export async function gitWorktrees(repositoryPath) {
  return { worktrees: parseWorktrees(await git(repositoryPath, ['worktree', 'list', '--porcelain'])) };
}

export async function createGitWorktree(repositoryPath, { path, branch, from = 'HEAD' } = {}) {
  if (!path || typeof path !== 'string' || !isAbsolute(path)) {
    throw new CodeSurfError('CODESURF_BAD_REQUEST', 'absolute worktree path required');
  }
  if (!branch || typeof branch !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new CodeSurfError('CODESURF_BAD_REQUEST', 'safe branch name required');
  }
  const target = resolve(path);
  await git(repositoryPath, ['worktree', 'add', '-b', branch, target, from]);
  return { path: target, branch, from };
}
