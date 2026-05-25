/**
 * Anthropic Credential Resolver
 *
 * 3단계 순서로 Anthropic OAuth/API 크레덴셜을 탐색한다:
 *
 * 1. Claude 설정 파일 (~/.claude/.credentials.json, ~/.claude.json)
 * 2. macOS Keychain (darwin 전용)
 * 3. mastracode auth 스토리지 (~/Library/Application Support/mastracode/auth.json)
 *    → 만료 시 OAuth token refresh 시도
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, dirname } from 'node:path'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnthropicCredential {
  type: 'oauth' | 'api_key'
  access: string
  refresh?: string
  expires?: number
  source: 'claude-config' | 'keychain' | 'mastracode'
}

// auth.json 내부 구조
interface AuthStorage {
  anthropic?: {
    type: 'oauth'
    access: string
    refresh?: string
    expires?: number
  }
}

// OAuth token refresh 응답
interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ANTHROPIC_OAUTH_REFRESH_URL = 'https://api.anthropic.com/oauth/token'

// ── Paths ─────────────────────────────────────────────────────────────────────

/**
 * OS별 mastracode auth 스토리지 경로를 반환한다.
 * macOS: ~/Library/Application Support/mastracode/auth.json
 * Linux: ~/.config/mastracode/auth.json
 * Windows: %APPDATA%/mastracode/auth.json
 */
export function getAuthStoragePath(): string {
  const os = platform()
  const home = homedir()

  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'mastracode', 'auth.json')
  }

  if (os === 'win32') {
    const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    return join(appData, 'mastracode', 'auth.json')
  }

  // Linux 및 기타
  const configHome = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config')
  return join(configHome, 'mastracode', 'auth.json')
}

// ── Step 1: Claude 설정 파일 탐색 ─────────────────────────────────────────────

function resolveFromClaudeConfig(): AnthropicCredential | null {
  const home = homedir()
  const candidates = [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude.json'),
  ]

  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue

      const raw = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>

      // OAuth 필드 탐색 순서
      const oauthAccess =
        (parsed['claudeAiOauth'] as Record<string, unknown> | undefined)?.['accessToken'] as string | undefined
        ?? parsed['oauthAccessToken'] as string | undefined
        ?? parsed['oauth_access_token'] as string | undefined

      if (oauthAccess) {
        const claudeAiOauth = parsed['claudeAiOauth'] as Record<string, unknown> | undefined
        return {
          type: 'oauth',
          access: oauthAccess,
          refresh: (claudeAiOauth?.['refreshToken'] as string | undefined)
            ?? (parsed['oauthRefreshToken'] as string | undefined),
          expires: (claudeAiOauth?.['expiresAt'] as number | undefined)
            ?? (parsed['oauthExpiresAt'] as number | undefined),
          source: 'claude-config',
        }
      }

      // API key 필드 탐색
      const apiKey =
        parsed['apiKey'] as string | undefined
        ?? parsed['api_key'] as string | undefined

      if (apiKey) {
        return {
          type: 'api_key',
          access: apiKey,
          source: 'claude-config',
        }
      }
    } catch {
      // 파일 읽기/파싱 실패 → 다음 단계로
    }
  }

  return null
}

// ── Step 2: macOS Keychain 탐색 (darwin 전용) ─────────────────────────────────

function resolveFromKeychain(): AnthropicCredential | null {
  if (platform() !== 'darwin') return null

  const keychainQueries = [
    'security find-generic-password -s "claude-cli" -a "api-key" -w',
    'security find-generic-password -s "anthropic-api-key" -w',
  ]

  for (const cmd of keychainQueries) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
      if (result) {
        return {
          type: 'api_key',
          access: result,
          source: 'keychain',
        }
      }
    } catch {
      // keychain 항목 없음 또는 접근 거부 → 다음 쿼리로
    }
  }

  return null
}

// ── Step 3: mastracode auth 스토리지 탐색 ─────────────────────────────────────

async function refreshOAuthToken(refreshToken: string): Promise<OAuthTokenResponse | null> {
  try {
    const response = await fetch(ANTHROPIC_OAUTH_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) return null

    return (await response.json()) as OAuthTokenResponse
  } catch {
    return null
  }
}

async function resolveFromAuthStorage(): Promise<AnthropicCredential | null> {
  const authPath = getAuthStoragePath()

  try {
    if (!existsSync(authPath)) return null

    const raw = readFileSync(authPath, 'utf-8')
    const storage = JSON.parse(raw) as AuthStorage

    const anthropic = storage.anthropic
    if (!anthropic?.access) return null

    // 만료 여부 확인
    const isExpired = anthropic.expires != null && Date.now() >= anthropic.expires

    if (!isExpired) {
      return {
        type: 'oauth',
        access: anthropic.access,
        refresh: anthropic.refresh,
        expires: anthropic.expires,
        source: 'mastracode',
      }
    }

    // 만료됨 → refresh 시도
    if (!anthropic.refresh) return null

    const refreshed = await refreshOAuthToken(anthropic.refresh)
    if (!refreshed) return null

    const newCredential: AnthropicCredential = {
      type: 'oauth',
      access: refreshed.access_token,
      refresh: refreshed.refresh_token ?? anthropic.refresh,
      expires: refreshed.expires_in != null
        ? Date.now() + refreshed.expires_in * 1000
        : undefined,
      source: 'mastracode',
    }

    // auth.json 업데이트
    saveAnthropicCredentialToAuthStorage({
      type: 'oauth',
      access: newCredential.access,
      refresh: newCredential.refresh,
      expires: newCredential.expires,
    })

    return newCredential
  } catch {
    return null
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 3단계 순서로 Anthropic 크레덴셜을 탐색한다.
 *
 * 1. ~/.claude/.credentials.json 또는 ~/.claude.json
 * 2. macOS Keychain (darwin만)
 * 3. ~/Library/Application Support/mastracode/auth.json (만료 시 refresh 시도)
 *
 * 모든 단계에서 찾지 못하면 null 반환.
 */
export async function resolveAnthropicCredential(): Promise<AnthropicCredential | null> {
  // Step 1: Claude 설정 파일
  const fromConfig = resolveFromClaudeConfig()
  if (fromConfig) return fromConfig

  // Step 2: macOS Keychain
  const fromKeychain = resolveFromKeychain()
  if (fromKeychain) return fromKeychain

  // Step 3: mastracode auth 스토리지 (비동기 — refresh 가능)
  const fromAuthStorage = await resolveFromAuthStorage()
  if (fromAuthStorage) return fromAuthStorage

  return null
}

/**
 * mastracode auth 스토리지에 Anthropic OAuth 크레덴셜을 저장한다.
 * 디렉터리가 없으면 자동 생성.
 */
export function saveAnthropicCredentialToAuthStorage(credential: {
  type: 'oauth'
  access: string
  refresh?: string
  expires?: number
}): void {
  const authPath = getAuthStoragePath()
  const authDir = dirname(authPath)

  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true })
  }

  let existing: AuthStorage = {}
  try {
    if (existsSync(authPath)) {
      existing = JSON.parse(readFileSync(authPath, 'utf-8')) as AuthStorage
    }
  } catch {
    // 기존 파일 파싱 실패 → 빈 객체로 시작
  }

  const updated: AuthStorage = {
    ...existing,
    anthropic: {
      type: credential.type,
      access: credential.access,
      ...(credential.refresh != null ? { refresh: credential.refresh } : {}),
      ...(credential.expires != null ? { expires: credential.expires } : {}),
    },
  }

  writeFileSync(authPath, JSON.stringify(updated, null, 2), { mode: 0o600 })
}
