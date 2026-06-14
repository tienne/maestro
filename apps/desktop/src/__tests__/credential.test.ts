/**
 * Anthropic Credential Resolver 단위 테스트
 *
 * 3단계 탐색 우선순위(claude-config → keychain → mastracode)와
 * 각 경로의 폴백 동작을 검증한다.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── fs / os / child_process mock ──────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'linux'), // 기본값: linux (keychain 비활성)
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return actual;
});

// ── 전역 fetch mock ───────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── import ────────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as child_process from 'node:child_process';

// credential 모듈은 mock 설정 후 동적 import
async function getCredentialModule() {
  return await import('../main/host-service/credential');
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedWriteFileSync = vi.mocked(fs.writeFileSync);
const mockedMkdirSync = vi.mocked(fs.mkdirSync);
const mockedExecSync = vi.mocked(child_process.execSync);
const mockedPlatform = vi.mocked(os.platform);
const mockedHomedir = vi.mocked(os.homedir);

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('resolveAnthropicCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // 매 테스트마다 캐시된 module 초기화
    mockedHomedir.mockReturnValue('/home/testuser');
    mockedPlatform.mockReturnValue('linux');
    // 기본값: 파일 없음
    mockedExistsSync.mockReturnValue(false);
    mockFetch.mockResolvedValue({ ok: false });
  });

  // ── Step 1: Claude 설정 파일 ────────────────────────────────────────────────

  describe('Step 1 — claude-config 파일', () => {
    it('~/.claude/.credentials.json의 claudeAiOauth.accessToken을 우선 반환한다', async () => {
      mockedExistsSync.mockImplementation((p) => {
        return (p as string).includes('.claude/.credentials.json');
      });
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'oauth-token-abc',
            refreshToken: 'refresh-xyz',
            expiresAt: 9999999999000,
          },
        }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toMatchObject({
        type: 'oauth',
        access: 'oauth-token-abc',
        refresh: 'refresh-xyz',
        source: 'claude-config',
      });
    });

    it('oauthAccessToken 필드도 인식한다', async () => {
      mockedExistsSync.mockImplementation((p) =>
        (p as string).includes('.claude/.credentials.json'),
      );
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ oauthAccessToken: 'flat-oauth-token' }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result?.access).toBe('flat-oauth-token');
      expect(result?.type).toBe('oauth');
    });

    it('apiKey 필드를 api_key 타입으로 반환한다', async () => {
      mockedExistsSync.mockImplementation((p) =>
        (p as string).includes('.claude/.credentials.json'),
      );
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ apiKey: 'sk-ant-test1234' }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toMatchObject({
        type: 'api_key',
        access: 'sk-ant-test1234',
        source: 'claude-config',
      });
    });

    it('~/.claude.json도 폴백으로 탐색한다', async () => {
      mockedExistsSync.mockImplementation((p) => {
        // .credentials.json 없고 .claude.json만 있음
        return (p as string).endsWith('.claude.json');
      });
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ apiKey: 'key-from-claude-json' }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result?.access).toBe('key-from-claude-json');
    });

    it('파일 파싱 실패 시 다음 단계로 넘어간다', async () => {
      mockedExistsSync.mockImplementation((p) =>
        (p as string).includes('.claude'),
      );
      mockedReadFileSync.mockImplementation(() => {
        throw new SyntaxError('Unexpected token');
      });

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      // 모든 경로 실패 → null
      expect(result).toBeNull();
    });
  });

  // ── Step 2: macOS Keychain ──────────────────────────────────────────────────

  describe('Step 2 — macOS Keychain (darwin 전용)', () => {
    beforeEach(() => {
      // Claude 설정 파일 없음
      mockedExistsSync.mockReturnValue(false);
    });

    it('darwin 플랫폼에서 keychain에서 API 키를 가져온다', async () => {
      mockedPlatform.mockReturnValue('darwin');
      mockedExecSync.mockReturnValueOnce('sk-ant-keychain-key\n' as unknown as Buffer);

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toMatchObject({
        type: 'api_key',
        access: 'sk-ant-keychain-key',
        source: 'keychain',
      });
    });

    it('첫 번째 keychain 쿼리 실패 시 두 번째를 시도한다', async () => {
      mockedPlatform.mockReturnValue('darwin');
      // 첫 번째 실패, 두 번째 성공
      mockedExecSync
        .mockImplementationOnce(() => { throw new Error('not found'); })
        .mockReturnValueOnce('sk-ant-second\n' as unknown as Buffer);

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result?.access).toBe('sk-ant-second');
    });

    it('linux 플랫폼에서는 keychain을 시도하지 않는다', async () => {
      mockedPlatform.mockReturnValue('linux');

      const { resolveAnthropicCredential } = await getCredentialModule();
      await resolveAnthropicCredential();

      expect(mockedExecSync).not.toHaveBeenCalled();
    });

    it('darwin이어도 keychain 모두 실패하면 Step 3으로 넘어간다', async () => {
      mockedPlatform.mockReturnValue('darwin');
      mockedExecSync.mockImplementation(() => { throw new Error('not found'); });

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      // Step 3도 파일 없음 → null
      expect(result).toBeNull();
    });
  });

  // ── Step 3: mastracode auth 스토리지 ───────────────────────────────────────

  describe('Step 3 — mastracode auth.json', () => {
    beforeEach(() => {
      // Step 1, 2 모두 실패
      mockedExistsSync.mockImplementation((p) =>
        (p as string).includes('mastracode/auth.json'),
      );
      mockedPlatform.mockReturnValue('linux');
    });

    it('auth.json에서 만료되지 않은 OAuth 토큰을 반환한다', async () => {
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          anthropic: {
            type: 'oauth',
            access: 'auth-storage-token',
            refresh: 'refresh-token',
            expires: Date.now() + 3_600_000, // 1시간 후
          },
        }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toMatchObject({
        type: 'oauth',
        access: 'auth-storage-token',
        source: 'mastracode',
      });
    });

    it('토큰이 만료됐고 refresh에 성공하면 새 토큰을 반환한다', async () => {
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          anthropic: {
            type: 'oauth',
            access: 'expired-token',
            refresh: 'valid-refresh-token',
            expires: Date.now() - 1000, // 이미 만료
          },
        }),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
        }),
      });

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result?.access).toBe('new-access-token');
      expect(result?.refresh).toBe('new-refresh-token');
    });

    it('토큰이 만료됐고 refresh 토큰 없으면 null을 반환한다', async () => {
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          anthropic: {
            type: 'oauth',
            access: 'expired-token',
            expires: Date.now() - 1000,
            // refresh 없음
          },
        }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toBeNull();
    });

    it('auth.json에 anthropic 필드 없으면 null을 반환한다', async () => {
      mockedReadFileSync.mockReturnValue(JSON.stringify({}));

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toBeNull();
    });
  });

  // ── 전체 폴백 흐름 ─────────────────────────────────────────────────────────

  describe('전체 폴백 흐름', () => {
    it('세 단계 모두 실패하면 null을 반환한다', async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedPlatform.mockReturnValue('linux');

      const { resolveAnthropicCredential } = await getCredentialModule();
      const result = await resolveAnthropicCredential();

      expect(result).toBeNull();
    });

    it('Step 1이 성공하면 Step 2, 3은 실행되지 않는다', async () => {
      mockedPlatform.mockReturnValue('darwin');
      mockedExistsSync.mockImplementation((p) =>
        (p as string).includes('.credentials.json'),
      );
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ apiKey: 'step1-key' }),
      );

      const { resolveAnthropicCredential } = await getCredentialModule();
      await resolveAnthropicCredential();

      // keychain execSync가 호출되지 않았음
      expect(mockedExecSync).not.toHaveBeenCalled();
      // fetch(refresh)도 호출되지 않았음
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── getAuthStoragePath ──────────────────────────────────────────────────────

  describe('getAuthStoragePath', () => {
    it('macOS에서 Library/Application Support/mastracode/auth.json 경로를 반환한다', async () => {
      mockedPlatform.mockReturnValue('darwin');
      mockedHomedir.mockReturnValue('/Users/testuser');

      const { getAuthStoragePath } = await getCredentialModule();
      const p = getAuthStoragePath();

      expect(p).toContain('Library/Application Support/mastracode/auth.json');
    });

    it('linux에서 ~/.config/mastracode/auth.json 경로를 반환한다', async () => {
      mockedPlatform.mockReturnValue('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
      delete process.env['XDG_CONFIG_HOME'];

      const { getAuthStoragePath } = await getCredentialModule();
      const p = getAuthStoragePath();

      expect(p).toContain('.config/mastracode/auth.json');
    });

    it('XDG_CONFIG_HOME 환경변수가 있으면 이를 사용한다', async () => {
      mockedPlatform.mockReturnValue('linux');
      process.env['XDG_CONFIG_HOME'] = '/custom/config';

      const { getAuthStoragePath } = await getCredentialModule();
      const p = getAuthStoragePath();

      expect(p).toContain('/custom/config/mastracode/auth.json');
      delete process.env['XDG_CONFIG_HOME'];
    });
  });

  // ── saveAnthropicCredentialToAuthStorage ───────────────────────────────────

  describe('saveAnthropicCredentialToAuthStorage', () => {
    it('auth.json에 크리덴셜을 JSON으로 저장한다', async () => {
      mockedExistsSync.mockReturnValue(true); // 디렉터리 이미 존재
      mockedReadFileSync.mockReturnValue('{}');

      const { saveAnthropicCredentialToAuthStorage } = await getCredentialModule();
      saveAnthropicCredentialToAuthStorage({
        type: 'oauth',
        access: 'new-access',
        refresh: 'new-refresh',
        expires: 9999999999000,
      });

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('auth.json'),
        expect.stringContaining('"access": "new-access"'),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it('디렉터리가 없으면 mkdirSync로 생성한다', async () => {
      mockedExistsSync.mockReturnValue(false);

      const { saveAnthropicCredentialToAuthStorage } = await getCredentialModule();
      saveAnthropicCredentialToAuthStorage({
        type: 'oauth',
        access: 'token',
      });

      expect(mockedMkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true },
      );
    });

    it('기존 auth.json 내용을 보존하면서 anthropic 필드만 덮어쓴다', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ otherService: { token: 'keep-me' } }),
      );

      const { saveAnthropicCredentialToAuthStorage } = await getCredentialModule();
      saveAnthropicCredentialToAuthStorage({
        type: 'oauth',
        access: 'updated-token',
      });

      const written = mockedWriteFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(written) as Record<string, unknown>;
      expect(parsed['otherService']).toMatchObject({ token: 'keep-me' });
      expect((parsed['anthropic'] as Record<string, unknown>)?.['access']).toBe('updated-token');
    });
  });
});
