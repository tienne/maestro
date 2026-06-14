/**
 * TokenManager
 *
 * OAuth access token 만료 감지 + 자동 갱신 + 갱신 실패 시 재인증 이벤트 emit.
 *
 * host-service child process 내부에서 실행되며 Electron IPC를 직접 사용하지 않는다.
 * 재인증이 필요할 때는 process.send 또는 stdout 특수 메시지로 부모(Electron main)에 알린다.
 */

import { EventEmitter } from 'node:events'
import {
  resolveAnthropicCredential,
  saveAnthropicCredentialToAuthStorage,
  type AnthropicCredential,
} from './credential'
import log from 'electron-log'

// ── Constants ─────────────────────────────────────────────────────────────────

const ANTHROPIC_OAUTH_REFRESH_URL = 'https://api.anthropic.com/oauth/token'

/** 만료까지 이 시간 이내면 미리 refresh를 시도한다 (5분). */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000

/** refresh 타이머는 만료 N분 전에 발동한다 (6분 — refresh 시도 여유 포함). */
const TIMER_LEAD_MS = 6 * 60 * 1000

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export interface TokenManagerEvents {
  'reauth-required': () => void
  'token-refreshed': (credential: AnthropicCredential) => void
}

// TypeScript typed EventEmitter declaration
export declare interface TokenManager {
  on<K extends keyof TokenManagerEvents>(event: K, listener: TokenManagerEvents[K]): this
  off<K extends keyof TokenManagerEvents>(event: K, listener: TokenManagerEvents[K]): this
  emit<K extends keyof TokenManagerEvents>(
    event: K,
    ...args: Parameters<TokenManagerEvents[K]>
  ): boolean
}

// ── TokenManager ──────────────────────────────────────────────────────────────

export class TokenManager extends EventEmitter {
  private currentCredential: AnthropicCredential | null = null
  private refreshTimer: NodeJS.Timeout | null = null

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * 앱 시작 시 호출한다.
   * 크레덴셜을 로드하고, OAuth 토큰이면 만료 전 자동 갱신 타이머를 등록한다.
   */
  async initialize(): Promise<void> {
    this.currentCredential = await resolveAnthropicCredential()

    if (this.currentCredential?.type === 'oauth' && this.currentCredential.expires != null) {
      this.scheduleRefresh(this.currentCredential.expires)
    }
  }

  /**
   * 현재 유효한 access token을 반환한다.
   * - 크레덴셜이 없으면 재탐색 시도
   * - OAuth 토큰이 만료 5분 이내면 미리 refresh 시도
   * - refresh 실패 시 'reauth-required' 이벤트 emit 후 null 반환
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.currentCredential) {
      this.currentCredential = await resolveAnthropicCredential()
    }

    if (!this.currentCredential) return null

    // API key는 만료 개념 없음 — 바로 반환
    if (this.currentCredential.type === 'api_key') {
      return this.currentCredential.access
    }

    // OAuth: 만료 5분 이내면 미리 refresh
    if (
      this.currentCredential.expires != null &&
      Date.now() >= this.currentCredential.expires - REFRESH_BEFORE_EXPIRY_MS &&
      this.currentCredential.refresh
    ) {
      const refreshed = await this.refreshToken(this.currentCredential.refresh)
      if (refreshed) {
        this.currentCredential = refreshed
      } else {
        this._emitReauthRequired()
        return null
      }
    }

    return this.currentCredential.access
  }

  /**
   * 현재 크레덴셜을 교체한다.
   * 외부에서 재인증 완료 후 새 토큰을 주입할 때 사용한다.
   */
  setCredential(credential: AnthropicCredential): void {
    this._clearRefreshTimer()
    this.currentCredential = credential

    if (credential.type === 'oauth' && credential.expires != null) {
      this.scheduleRefresh(credential.expires)
    }
  }

  /**
   * 타이머를 정리하고 크레덴셜을 초기화한다.
   */
  dispose(): void {
    this._clearRefreshTimer()
    this.currentCredential = null
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * 만료 TIMER_LEAD_MS 전에 자동 refresh를 시작하는 타이머를 등록한다.
   * 이미 만료됐거나 임박한 경우 즉시 refresh를 시도한다.
   */
  private scheduleRefresh(expiresAt: number): void {
    this._clearRefreshTimer()

    const delay = expiresAt - Date.now() - TIMER_LEAD_MS

    if (delay <= 0) {
      // 이미 임박했거나 만료 → 바로 시도
      void this._attemptScheduledRefresh()
      return
    }

    this.refreshTimer = setTimeout(() => {
      void this._attemptScheduledRefresh()
    }, delay)

    // Node.js 프로세스 종료를 막지 않도록 unref
    this.refreshTimer.unref()
  }

  private async _attemptScheduledRefresh(): Promise<void> {
    if (!this.currentCredential?.refresh) {
      this._emitReauthRequired()
      return
    }

    const refreshed = await this.refreshToken(this.currentCredential.refresh)
    if (refreshed) {
      this.currentCredential = refreshed
    } else {
      this._emitReauthRequired()
    }
  }

  /**
   * refresh_token으로 Anthropic OAuth 토큰을 갱신한다.
   * 성공 시 저장 후 새 크레덴셜을 반환하고 'token-refreshed' 이벤트를 emit한다.
   * 실패 시 null 반환.
   */
  private async refreshToken(refreshToken: string): Promise<AnthropicCredential | null> {
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

      const data = (await response.json()) as OAuthTokenResponse

      const newCredential: AnthropicCredential = {
        type: 'oauth',
        access: data.access_token,
        refresh: data.refresh_token ?? refreshToken,
        expires: data.expires_in != null
          ? Date.now() + data.expires_in * 1000
          : undefined,
        source: 'mastracode',
      }

      // auth.json에 저장
      saveAnthropicCredentialToAuthStorage({
        type: 'oauth',
        access: newCredential.access,
        refresh: newCredential.refresh,
        expires: newCredential.expires,
      })

      // 다음 만료 전 자동 갱신 타이머 재등록
      if (newCredential.expires != null) {
        this.scheduleRefresh(newCredential.expires)
      }

      this.emit('token-refreshed', newCredential)
      return newCredential
    } catch {
      return null
    }
  }

  /**
   * 'reauth-required' 이벤트를 emit하고
   * host-service → Electron main 프로세스에 신호를 보낸다.
   *
   * Electron main은 HOST_REAUTH_REQUIRED stdout 라인을 감지해
   * renderer에 재인증 요청을 전달한다.
   */
  private _emitReauthRequired(): void {
    this.emit('reauth-required')

    log.warn('[token-manager] reauth required — emitting HOST_REAUTH_REQUIRED signal')
    // stdout 특수 메시지 — Electron main의 stdout 파서가 감지
    // (index.ts의 HOST_SERVICE_PORT= 패턴과 동일한 방식)
    // electron-log로 교체 불가: main 프로세스가 stdout에서 이 문자열을 파싱함
    console.log('HOST_REAUTH_REQUIRED')

    // IPC 채널이 열려 있으면 구조화 메시지도 전송
    process.send?.({ type: 'reauth-required' })
  }

  private _clearRefreshTimer(): void {
    if (this.refreshTimer != null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const tokenManager = new TokenManager()
