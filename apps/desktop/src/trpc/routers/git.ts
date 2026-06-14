/**
 * gitRouter — 원본 router.ts lines 2382-2841
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq } from 'drizzle-orm';
import { getGitService } from '../../services/git';
import { getGitWatcher } from '../../services/git-watcher';
import { simpleGit } from 'simple-git';

// ── Git diff parser ───────────────────────────────────────────────────────────

function parseUnifiedDiff(raw: string): Array<{ header: string; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> {
  const hunks: Array<{ header: string; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> = [];
  let current: (typeof hunks)[0] | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@ ')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.lines.push({ type: 'added', content: line.slice(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.lines.push({ type: 'removed', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        current.lines.push({ type: 'context', content: line.slice(1) });
      }
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export const gitRouter = router({
  // 실시간 Git 상태 구독 (chokidar 기반)
  watchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .subscription(({ input }) => {
      return observable<Awaited<ReturnType<typeof getGitWatcher['prototype']['getStatus']>>>((emit) => {
        const unwatch = getGitWatcher().watch(input.repoPath, (status) => {
          emit.next(status);
        });
        return () => unwatch();
      });
    }),

  // 단일 파일 stage
  stage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.add(input.filePath);
    }),

  // 단일 파일 unstage
  unstage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.reset(['HEAD', '--', input.filePath]);
    }),

  // 전체 stage
  stageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.add('-A');
    }),

  // 전체 unstage
  unstageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.reset(['HEAD']);
    }),

  // 현재 상태 스냅샷 조회 (단순 쿼리, 구독 없이)
  status: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitWatcher().getStatus(input.repoPath);
    }),

  // ─── 기존 호환 유지 ───────────────────────────────────────────────────────

  diff: publicProcedure
    .input(
      z.object({
        workspacePath: z.string().min(1),
        filePath: z.string().min(1),
        staged: z.boolean(),
      })
    )
    .query(({ input }) => {
      return getGitService().diff(input.workspacePath, input.filePath, input.staged);
    }),

  getDiff: publicProcedure
    .input(z.object({ workspacePath: z.string().min(1) }))
    .query(({ input }) => {
      return getGitService().getStructuredDiff(input.workspacePath);
    }),

  commit: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), message: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const result = await git.commit(input.message);
      return { hash: result.commit, summary: result.summary };
    }),

  // push to remote
  push: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      remote: z.string().default('origin'),
      branch: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const pushResult = await git.push(input.remote, input.branch);
      return { pushed: pushResult.pushed };
    }),

  // pull from remote
  pull: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      remote: z.string().default('origin'),
      branch: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const pullResult = await git.pull(input.remote, input.branch);
      return { summary: pullResult.summary };
    }),

  // branch list
  branches: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const local = await git.branchLocal();
      return {
        current: local.current,
        branches: Object.values(local.branches).map((b) => ({
          name: b.name,
          commit: b.commit,
          label: b.label,
        })),
      };
    }),

  // branch checkout
  checkout: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), branch: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.checkout(input.branch);
      return { branch: input.branch };
    }),

  // file diff (unified format, parsed into hunks)
  fileDiff: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      filePath: z.string().min(1),
      staged: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const args = input.staged
        ? ['--cached', '--', input.filePath]
        : ['--', input.filePath];
      let raw = '';
      try {
        raw = await git.diff(args);
        if (!raw) {
          // new file staged — compare against /dev/null
          raw = await git.diff(['--cached', '--', input.filePath]);
        }
      } catch {
        raw = '';
      }
      return { raw, hunks: parseUnifiedDiff(raw) };
    }),

  readDir: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query(({ input }) => {
      return getGitService().readDir(input.dirPath);
    }),

  // ── F-M1-01: Commit History ─────────────────────────────────────────────────

  getHistory: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      limit: z.number().int().positive().max(200).default(50),
    }))
    .query(async ({ input }) => {
      return getGitService().getHistory(input.repoPath, input.limit);
    }),

  showCommit: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const raw = await getGitService().showCommit(input.repoPath, input.commitHash);
      return { raw, hunks: parseUnifiedDiff(raw) };
    }),

  // ── F-M1-02: Stash Management ──────────────────────────────────────────────

  stashList: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().stashList(input.repoPath);
    }),

  stashPush: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      message: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashPush(input.repoPath, input.message);
    }),

  stashPop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashPop(input.repoPath, input.index);
    }),

  stashDrop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashDrop(input.repoPath, input.index);
    }),

  // ── F-M1-03: Fetch & Remote Branch Tracking ────────────────────────────────

  fetch: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await getGitService().fetchAll(input.repoPath);
      return { success: true };
    }),

  getBranchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().getBranchStatus(input.repoPath);
    }),

  // ── F-M1-04: Git Reset & Revert ────────────────────────────────────────────

  reset: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
      mode: z.enum(['soft', 'mixed', 'hard']),
    }))
    .mutation(async ({ input }) => {
      return getGitService().reset(input.repoPath, input.commitHash, input.mode);
    }),

  revert: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().revert(input.repoPath, input.commitHash);
    }),

  discardAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().discardAll(input.repoPath);
    }),

  // ── F-M1-05: Blame ─────────────────────────────────────────────────────────

  blame: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      filePath: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return getGitService().blame(input.repoPath, input.filePath);
    }),

  // ── F-M1-06: Tag Management ────────────────────────────────────────────────

  listTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().listTags(input.repoPath);
    }),

  createTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
      message: z.string().optional(),
      annotated: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      return getGitService().createTag(input.repoPath, input.name, input.message, input.annotated);
    }),

  deleteTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().deleteTag(input.repoPath, input.name);
    }),

  pushTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().pushTags(input.repoPath);
    }),

  // ── F-M1-07: Cherry-pick ──────────────────────────────────────────────────

  cherryPick: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().cherryPick(input.repoPath, input.commitHash);
    }),

  cherryPickAbort: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().cherryPickAbort(input.repoPath);
    }),

  // ── F-M1-08: Squash Commits ───────────────────────────────────────────────

  getRecentCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
    }))
    .query(async ({ input }) => {
      return getGitService().getRecentCommits(input.repoPath, input.count);
    }),

  squashCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
      message: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().squashCommits(input.repoPath, input.count, input.message);
    }),

  // worktree branch → base branch 병합
  merge: publicProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      strategy: z.enum(['squash', 'rebase', 'merge']),
    }))
    .mutation(async ({ input }): Promise<{ success: boolean; message: string }> => {
      const drizzle = getDatabaseManager().drizzle;

      // 1. workspace 조회
      const [wsRow] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, input.workspaceId)).all();
      if (!wsRow) {
        return { success: false, message: 'Workspace not found' };
      }
      const workspace = { id: wsRow.id, name: wsRow.name, repositoryId: wsRow.repositoryId, branch: wsRow.branch, worktreePath: wsRow.worktreePath, createdAt: wsRow.createdAt };

      // 2. repository 조회 → baseBranch 확인
      const [repoRow] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, workspace.repositoryId)).all();
      if (!repoRow) {
        return { success: false, message: 'Repository not found' };
      }
      const repo = { id: repoRow.id, name: repoRow.name, path: repoRow.path, color: repoRow.color, branchPrefix: repoRow.branchPrefix, baseBranch: repoRow.baseBranch, worktreeBasePath: repoRow.worktreeBasePath, setupScript: repoRow.setupScript, teardownScript: repoRow.teardownScript, createdAt: repoRow.createdAt };
      const baseBranch = repo.baseBranch || 'main';

      // 3. worktree 경로에서 simple-git 인스턴스 생성
      const git = simpleGit(workspace.worktreePath);

      // 4. uncommitted changes 확인
      const statusResult = await git.status();
      const hasUncommitted = statusResult.modified.length > 0
        || statusResult.not_added.length > 0
        || statusResult.staged.length > 0
        || statusResult.deleted.length > 0
        || statusResult.created.length > 0;

      if (hasUncommitted) {
        return { success: false, message: 'Uncommitted changes detected. Please commit or stash changes before merging.' };
      }

      // 5. 현재 브랜치 확인
      const currentBranch = workspace.branch;
      if (currentBranch === baseBranch) {
        return { success: false, message: `Already on base branch (${baseBranch}). Nothing to merge.` };
      }

      try {
        // 6. 메인 저장소 경로에서 병합 수행
        const mainGit = simpleGit(repo.path);

        // base branch로 checkout
        await mainGit.checkout(baseBranch);

        // 7. strategy에 따른 병합
        switch (input.strategy) {
          case 'squash': {
            await mainGit.merge([currentBranch, '--squash']);
            // squash merge 후 자동 커밋
            await mainGit.commit(`Squash merge branch '${currentBranch}' into ${baseBranch}`);
            break;
          }
          case 'rebase': {
            // rebase: worktree 브랜치의 커밋들을 base 위에 리베이스
            await mainGit.rebase([currentBranch]);
            break;
          }
          case 'merge': {
            await mainGit.merge([currentBranch, '--no-ff']);
            break;
          }
        }

        return {
          success: true,
          message: `Successfully merged '${currentBranch}' into '${baseBranch}' using ${input.strategy} strategy.`,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        // 충돌 발생 시 merge 중단
        try {
          const mainGit = simpleGit(repo.path);
          await mainGit.merge(['--abort']).catch(() => {});
          await mainGit.rebase(['--abort']).catch(() => {});
        } catch {
          // abort 실패는 무시
        }

        return { success: false, message: `Merge failed: ${errMsg}` };
      }
    }),
});
