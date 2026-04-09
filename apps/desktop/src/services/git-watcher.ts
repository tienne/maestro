/**
 * GitWatcher — chokidar 기반 실시간 Git 상태 감시 서비스
 *
 * .git 디렉토리를 감시하여 변경 시 등록된 콜백으로 최신 상태를 전달한다.
 * tRPC subscription의 observable 이벤트 소스로 사용된다.
 */

import chokidar, { FSWatcher } from 'chokidar';
import { simpleGit } from 'simple-git';
import * as path from 'path';

export interface GitStatusFile {
  path: string;
  index: string;  // staged status char
  working_dir: string;  // unstaged status char
}

export interface GitStatusResult {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  not_added: string[];
  conflicted: string[];
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
}

type StatusCallback = (status: GitStatusResult) => void;

interface WatchedRepo {
  watcher: FSWatcher;
  callbacks: Set<StatusCallback>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class GitWatcher {
  private watched: Map<string, WatchedRepo> = new Map();

  async getStatus(repoPath: string): Promise<GitStatusResult> {
    const git = simpleGit(repoPath);
    const status = await git.status();
    return {
      current: status.current,
      tracking: status.tracking,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged.map((f) => ({ path: f, index: 'M', working_dir: ' ' })),
      unstaged: status.modified.map((f) => ({ path: f, index: ' ', working_dir: 'M' })),
      not_added: status.not_added,
      conflicted: status.conflicted,
      created: status.created,
      deleted: status.deleted,
      modified: status.modified,
      renamed: status.renamed,
    };
  }

  watch(repoPath: string, callback: StatusCallback): () => void {
    const existing = this.watched.get(repoPath);

    if (existing) {
      existing.callbacks.add(callback);
      // 즉시 현재 상태 전달
      this.getStatus(repoPath)
        .then(callback)
        .catch(() => {});
      return () => existing.callbacks.delete(callback);
    }

    const gitDir = path.join(repoPath, '.git');
    const callbacks = new Set<StatusCallback>([callback]);

    const emit = () => {
      this.getStatus(repoPath)
        .then((s) => callbacks.forEach((cb) => cb(s)))
        .catch(() => {});
    };

    const watcher = chokidar.watch(gitDir, {
      ignored: /(index\.lock|COMMIT_EDITMSG)$/,
      persistent: true,
      ignoreInitial: false,
      depth: 2,
    });

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const debouncedEmit = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(emit, 150);
    };

    watcher.on('add', debouncedEmit);
    watcher.on('change', debouncedEmit);
    watcher.on('unlink', debouncedEmit);
    watcher.on('ready', emit);

    this.watched.set(repoPath, { watcher, callbacks, debounceTimer });

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        watcher.close();
        this.watched.delete(repoPath);
      }
    };
  }

  async close(): Promise<void> {
    for (const { watcher } of this.watched.values()) {
      await watcher.close();
    }
    this.watched.clear();
  }
}

let instance: GitWatcher | null = null;

export function getGitWatcher(): GitWatcher {
  if (!instance) {
    instance = new GitWatcher();
  }
  return instance;
}
