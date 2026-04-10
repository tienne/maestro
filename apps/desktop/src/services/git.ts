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

export interface BlameLine {
  lineNumber: number;
  commitHash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  content: string;
}

export interface TagInfo {
  name: string;
  hash: string;
  message: string;
  isAnnotated: boolean;
  date: string;
}

export interface CherryPickResult {
  success: boolean;
  conflicts: string[];
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
    // 1. git worktree 메타데이터 제거
    await this.execAsync(`git worktree remove --force "${worktreePath}"`, repoPath).catch(() => {});

    // 2. stale 항목 정리
    await this.execAsync('git worktree prune', repoPath).catch(() => {});

    // 3. 디렉토리가 남아있으면 강제 삭제 (git이 못 지운 경우 대비)
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('removeWorktree: failed to delete directory:', err);
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

  // ── F-M1-01: Commit History ──────────────────────────────────────────────────

  async getHistory(repoPath: string, limit = 50): Promise<Array<{ hash: string; shortHash: string; message: string; author: string; date: string; refs: string; graph: string }>> {
    const format = '%H%x00%h%x00%s%x00%an%x00%ai%x00%D';
    const raw = await this.execAsync(
      `git log --oneline --graph --decorate -${limit} --format="${format}"`,
      repoPath,
    );
    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map((line) => {
      // graph characters are before the format output
      const graphMatch = line.match(/^([*|/\\ ]+)/);
      const graph = graphMatch ? graphMatch[1] : '';
      const rest = line.slice(graph.length);
      const parts = rest.split('\x00');
      if (parts.length < 6) {
        // fallback: just return the raw line as message
        return { hash: '', shortHash: '', message: line.trim(), author: '', date: '', refs: '', graph };
      }
      return {
        hash: parts[0].trim(),
        shortHash: parts[1],
        message: parts[2],
        author: parts[3],
        date: parts[4],
        refs: parts[5],
        graph,
      };
    }).filter((c) => c.hash !== '');
  }

  async showCommit(repoPath: string, commitHash: string): Promise<string> {
    return this.execAsync(`git show "${commitHash}"`, repoPath);
  }

  // ── F-M1-02: Stash Management ──────────────────────────────────────────────

  async stashList(repoPath: string): Promise<Array<{ index: number; message: string; ref: string }>> {
    const raw = await this.execAsync('git stash list', repoPath);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line, i) => {
      // stash@{0}: WIP on main: abc1234 message
      const match = line.match(/^(stash@\{\d+\}):\s*(.*)$/);
      return {
        index: i,
        ref: match ? match[1] : `stash@{${i}}`,
        message: match ? match[2] : line,
      };
    });
  }

  async stashPush(repoPath: string, message?: string): Promise<string> {
    const msgFlag = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    return this.execAsync(`git stash push${msgFlag}`, repoPath);
  }

  async stashPop(repoPath: string, index = 0): Promise<string> {
    return this.execAsync(`git stash pop stash@{${index}}`, repoPath);
  }

  async stashDrop(repoPath: string, index = 0): Promise<string> {
    return this.execAsync(`git stash drop stash@{${index}}`, repoPath);
  }

  // ── F-M1-03: Fetch & Remote Branch Tracking ────────────────────────────────

  async fetchAll(repoPath: string): Promise<string> {
    return this.execAsync('git fetch --all', repoPath);
  }

  async getBranchStatus(repoPath: string): Promise<{ current: string; ahead: number; behind: number; tracking: string | null }> {
    const current = this.getCurrentBranch(repoPath);
    let tracking: string | null = null;
    let ahead = 0;
    let behind = 0;

    try {
      tracking = this.exec(`git rev-parse --abbrev-ref ${current}@{upstream}`, repoPath);
    } catch {
      // no upstream tracking branch
      return { current, ahead: 0, behind: 0, tracking: null };
    }

    try {
      const counts = this.exec(`git rev-list --left-right --count ${current}...${tracking}`, repoPath);
      const parts = counts.split('\t');
      ahead = parseInt(parts[0], 10) || 0;
      behind = parseInt(parts[1], 10) || 0;
    } catch {
      // rev-list failed
    }

    return { current, ahead, behind, tracking };
  }

  // ── F-M1-04: Git Reset & Revert ────────────────────────────────────────────

  async reset(repoPath: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<string> {
    return this.execAsync(`git reset --${mode} "${commitHash}"`, repoPath);
  }

  async revert(repoPath: string, commitHash: string): Promise<string> {
    return this.execAsync(`git revert --no-edit "${commitHash}"`, repoPath);
  }

  async discardAll(repoPath: string): Promise<string> {
    await this.execAsync('git checkout -- .', repoPath);
    // also clean untracked files
    await this.execAsync('git clean -fd', repoPath);
    return 'All changes discarded';
  }

  // ── F-M1-05: Blame ──────────────────────────────────────────────────────────

  async blame(repoPath: string, filePath: string): Promise<BlameLine[]> {
    const raw = await this.execAsync(
      `git blame --line-porcelain -- "${filePath}"`,
      repoPath,
    );
    if (!raw) return [];

    const lines: BlameLine[] = [];
    const blocks = raw.split(/(?=^[0-9a-f]{40}\s)/m);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const headerMatch = block.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
      if (!headerMatch) continue;

      const commitHash = headerMatch[1];
      const lineNumber = parseInt(headerMatch[2], 10);

      const authorMatch = block.match(/^author (.+)$/m);
      const dateMatch = block.match(/^author-time (\d+)$/m);
      const summaryMatch = block.match(/^summary (.+)$/m);
      const contentMatch = block.match(/^\t(.*)$/m);

      lines.push({
        lineNumber,
        commitHash,
        shortHash: commitHash.slice(0, 7),
        author: authorMatch?.[1] ?? 'Unknown',
        date: dateMatch ? new Date(parseInt(dateMatch[1], 10) * 1000).toISOString() : '',
        message: summaryMatch?.[1] ?? '',
        content: contentMatch?.[1] ?? '',
      });
    }

    return lines;
  }

  // ── F-M1-06: Tag Management ────────────────────────────────────────────────

  async listTags(repoPath: string): Promise<TagInfo[]> {
    let raw = '';
    try {
      raw = await this.execAsync(
        'git tag -l --format="%(objectname:short)%00%(refname:short)%00%(contents:subject)%00%(objecttype)%00%(creatordate:iso)"',
        repoPath,
      );
    } catch {
      return [];
    }
    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map((line) => {
      const parts = line.split('\x00');
      return {
        hash: parts[0] ?? '',
        name: parts[1] ?? '',
        message: parts[2] ?? '',
        isAnnotated: parts[3] === 'tag',
        date: parts[4] ?? '',
      };
    });
  }

  async createTag(repoPath: string, name: string, message?: string, annotated = true): Promise<string> {
    if (annotated && message) {
      return this.execAsync(`git tag -a "${name}" -m "${message.replace(/"/g, '\\"')}"`, repoPath);
    }
    return this.execAsync(`git tag "${name}"`, repoPath);
  }

  async deleteTag(repoPath: string, name: string): Promise<string> {
    return this.execAsync(`git tag -d "${name}"`, repoPath);
  }

  async pushTags(repoPath: string): Promise<string> {
    return this.execAsync('git push --tags', repoPath);
  }

  // ── F-M1-07: Cherry-pick ──────────────────────────────────────────────────

  async cherryPick(repoPath: string, commitHash: string): Promise<CherryPickResult> {
    try {
      await this.execAsync(`git cherry-pick "${commitHash}"`, repoPath);
      return { success: true, conflicts: [] };
    } catch (error) {
      // cherry-pick 충돌 감지
      try {
        const statusRaw = await this.execAsync('git status --porcelain', repoPath);
        const conflicts = statusRaw
          .split('\n')
          .filter((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD'))
          .map((line) => line.slice(3).trim());

        if (conflicts.length > 0) {
          return { success: false, conflicts };
        }
      } catch {
        // status 실패 시 원본 에러 전파
      }
      throw error;
    }
  }

  async cherryPickAbort(repoPath: string): Promise<string> {
    return this.execAsync('git cherry-pick --abort', repoPath);
  }

  // ── F-M1-08: Squash Commits ───────────────────────────────────────────────

  async getRecentCommits(repoPath: string, count: number): Promise<Array<{ hash: string; shortHash: string; message: string }>> {
    const raw = await this.execAsync(
      `git log HEAD~${count}..HEAD --format="%H%x00%h%x00%s"`,
      repoPath,
    );
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      const parts = line.split('\x00');
      return {
        hash: parts[0] ?? '',
        shortHash: parts[1] ?? '',
        message: parts[2] ?? '',
      };
    });
  }

  async squashCommits(repoPath: string, count: number, message: string): Promise<string> {
    // git reset --soft HEAD~N 후 git commit
    await this.execAsync(`git reset --soft HEAD~${count}`, repoPath);
    return this.execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, repoPath);
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
