import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitFileStatus {
  path: string;
  staged: boolean;
  status: string;
}

export interface DiffLine {
  lineType: 'added' | 'removed' | 'context';
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export class GitService {
  private exec(cmd: string, cwd: string): string {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  }

  private async execAsync(cmd: string, cwd: string): Promise<string> {
    const { stdout } = await execAsync(cmd, { cwd });
    return stdout.trim();
  }

  getCurrentBranch(repoPath: string): string {
    try {
      return this.exec('git symbolic-ref --short HEAD', repoPath);
    } catch {
      return this.exec('git rev-parse --short HEAD', repoPath);
    }
  }

  getRepoRoot(repoPath: string): string {
    return this.exec('git rev-parse --show-toplevel', repoPath);
  }

  isGitRepo(dirPath: string): boolean {
    try {
      this.exec('git rev-parse --git-dir', dirPath);
      return true;
    } catch {
      return false;
    }
  }

  async cloneRepo(url: string, targetPath: string): Promise<void> {
    await this.execAsync(`git clone "${url}" "${targetPath}"`, process.cwd());
  }

  async addWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    const exists = await this.branchExists(repoPath, branch);

    try {
      if (exists) {
        await this.execAsync(`git worktree add "${worktreePath}" "${branch}"`, repoPath);
      } else {
        await this.execAsync(`git worktree add -b "${branch}" "${worktreePath}"`, repoPath);
      }
    } catch (error) {
      // cleanup: worktree 디렉토리가 이미 생성됐으면 제거
      await this.execAsync(`git worktree remove --force "${worktreePath}"`, repoPath).catch(() => {});
      throw error;
    }
  }

  private async branchExists(repoPath: string, branch: string): Promise<boolean> {
    try {
      await this.execAsync(`git rev-parse --verify "${branch}"`, repoPath);
      return true;
    } catch {
      return false;
    }
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await this.execAsync(`git worktree remove --force "${worktreePath}"`, repoPath);
    } catch (error) {
      // worktree remove 실패 시 prune으로 stale 항목 정리
      console.warn('git worktree remove failed, trying prune:', error);
    } finally {
      // stale worktree 항목 정리 (실패해도 계속 진행)
      await this.execAsync('git worktree prune', repoPath).catch(() => {});
    }
  }

  status(workspacePath: string): GitFileStatus[] {
    const output = this.exec('git status --porcelain', workspacePath);
    if (!output) return [];

    return output.split('\n').filter(Boolean).map((line) => {
      const xy = line.slice(0, 2);
      const filePath = line.slice(3);
      const staged = xy[0] !== ' ' && xy[0] !== '?';
      return { path: filePath, staged, status: xy.trim() };
    });
  }

  diff(workspacePath: string, filePath: string, staged: boolean): string {
    const stagedFlag = staged ? '--cached' : '';
    try {
      return this.exec(`git diff ${stagedFlag} -- "${filePath}"`, workspacePath);
    } catch {
      return '';
    }
  }

  getStructuredDiff(workspacePath: string): FileDiff[] {
    let raw = '';
    try {
      // HEAD가 있으면 staged + unstaged 변경사항을 모두 포함
      raw = this.exec('git diff HEAD', workspacePath);
    } catch {
      // HEAD 커밋이 없는 새 저장소 — staged 변경사항만 표시
      try {
        raw = this.exec('git diff --cached', workspacePath);
      } catch {
        // staged도 없으면 빈 결과
      }
    }
    if (!raw) return [];
    return this.parseDiff(raw);
  }

  private parseDiff(raw: string): FileDiff[] {
    const files: FileDiff[] = [];
    let current: FileDiff | null = null;
    let currentHunk: DiffHunk | null = null;

    for (const line of raw.split('\n')) {
      if (line.startsWith('diff --git')) {
        if (current) files.push(current);
        current = { path: '', hunks: [] };
      } else if (line.startsWith('+++ b/') && current) {
        current.path = line.slice(6);
      } else if (line.startsWith('@@ ') && current) {
        if (currentHunk) current.hunks.push(currentHunk);
        currentHunk = { header: line, lines: [] };
      } else if (currentHunk) {
        if (line.startsWith('+')) {
          currentHunk.lines.push({ lineType: 'added', content: line.slice(1) });
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ lineType: 'removed', content: line.slice(1) });
        } else if (line.startsWith(' ')) {
          currentHunk.lines.push({ lineType: 'context', content: line.slice(1) });
        }
      }
    }

    if (currentHunk && current) current.hunks.push(currentHunk);
    if (current) files.push(current);

    return files;
  }

  stageAll(workspacePath: string): void {
    this.exec('git add -A', workspacePath);
  }

  commit(workspacePath: string, message: string): string {
    return this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, workspacePath);
  }

  readDir(dirPath: string): FsEntry[] {
    const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !SKIP.has(e.name))
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }
}

let instance: GitService | null = null;

export function getGitService(): GitService {
  if (!instance) {
    instance = new GitService();
  }
  return instance;
}
