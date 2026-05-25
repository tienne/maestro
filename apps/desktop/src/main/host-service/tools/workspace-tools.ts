/**
 * workspace-tools.ts — Mastra Agent용 워크스페이스 파일 시스템 도구
 *
 * host-service child process(Node.js) 안에서 실행된다.
 * Electron API 없음. node:fs/promises 직접 사용.
 *
 * 모든 경로는 workspacePath(절대 경로) 기준으로 resolve된다.
 * path traversal 공격 방지를 위해 resolve된 경로가 workspacePath 안인지 검증한다.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── 공통 유틸 ─────────────────────────────────────────────────────────────────

/**
 * relativePath를 workspacePath 안에서 resolve하고,
 * path traversal이 아닌지 확인한다.
 */
function resolveSafe(workspacePath: string, relativePath: string): string {
  const resolved = path.resolve(workspacePath, relativePath);
  if (!resolved.startsWith(path.resolve(workspacePath))) {
    throw new Error(
      `[workspace-tools] Path traversal 감지: "${relativePath}" 는 workspacePath 밖입니다.`,
    );
  }
  return resolved;
}

// ── readFileTool ───────────────────────────────────────────────────────────────

export const readFileTool = createTool({
  id: 'read_file',
  description:
    'Read the text content of a file inside the workspace. Returns the file content as a string.',
  inputSchema: z.object({
    /** 워크스페이스 루트 기준 상대 경로 (예: "src/index.ts") */
    path: z.string().describe('Relative path from the workspace root'),
    /** 워크스페이스 절대 경로 */
    workspacePath: z.string().describe('Absolute path to the workspace root'),
  }),
  execute: async (inputData) => {
    const fullPath = resolveSafe(inputData.workspacePath, inputData.path);
    const content = await fs.readFile(fullPath, 'utf-8');
    return { content };
  },
});

// ── writeFileTool ──────────────────────────────────────────────────────────────

export const writeFileTool = createTool({
  id: 'write_file',
  description:
    'Write (create or overwrite) a file inside the workspace. Parent directories are created automatically.',
  inputSchema: z.object({
    /** 워크스페이스 루트 기준 상대 경로 */
    path: z.string().describe('Relative path from the workspace root'),
    /** 워크스페이스 절대 경로 */
    workspacePath: z.string().describe('Absolute path to the workspace root'),
    /** 파일에 쓸 내용 */
    content: z.string().describe('Content to write to the file'),
  }),
  execute: async (inputData) => {
    const fullPath = resolveSafe(inputData.workspacePath, inputData.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, inputData.content, 'utf-8');
    return { success: true, path: inputData.path };
  },
});

// ── listFilesTool ──────────────────────────────────────────────────────────────

export const listFilesTool = createTool({
  id: 'list_files',
  description:
    'List files and directories inside a workspace directory. Returns names and types (file/directory).',
  inputSchema: z.object({
    /** 워크스페이스 루트 기준 상대 경로. 비어있으면 워크스페이스 루트 나열 */
    path: z
      .string()
      .optional()
      .describe('Relative path from the workspace root (default: root)'),
    /** 워크스페이스 절대 경로 */
    workspacePath: z.string().describe('Absolute path to the workspace root'),
  }),
  execute: async (inputData) => {
    const relativePath = inputData.path ?? '.';
    const fullPath = resolveSafe(inputData.workspacePath, relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const files = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
    }));

    return { path: relativePath, files };
  },
});

// ── deleteFileTool ─────────────────────────────────────────────────────────────

export const deleteFileTool = createTool({
  id: 'delete_file',
  description: 'Delete a file inside the workspace.',
  inputSchema: z.object({
    /** 워크스페이스 루트 기준 상대 경로 */
    path: z.string().describe('Relative path from the workspace root'),
    /** 워크스페이스 절대 경로 */
    workspacePath: z.string().describe('Absolute path to the workspace root'),
  }),
  execute: async (inputData) => {
    const fullPath = resolveSafe(inputData.workspacePath, inputData.path);
    await fs.unlink(fullPath);
    return { success: true, path: inputData.path };
  },
});

// ── 도구 모음 export ───────────────────────────────────────────────────────────

/**
 * Mastra Agent에 등록할 워크스페이스 도구 맵.
 *
 * ```ts
 * const agent = new Agent({ ..., tools: workspaceTools });
 * ```
 */
export const workspaceTools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_files: listFilesTool,
  delete_file: deleteFileTool,
} as const;
