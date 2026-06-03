import { safeStorage, shell, app } from 'electron'
import * as crypto from 'node:crypto'
import * as https from 'node:https'
import type { ChatProvider } from '@maestro/shared-types'

// PKCE helpers
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// 프로바이더 OAuth 설정
const OAUTH_CONFIG = {
  anthropic: {
    clientId: 'maestro-desktop',
    authEndpoint: 'https://claude.ai/oauth/authorize',
    tokenEndpoint: 'https://claude.ai/oauth/token',
    scopes: ['user:inference'],
  },
  openai: {
    clientId: 'YOUR_OPENAI_CLIENT_ID',
    authEndpoint: 'https://chat.openai.com/oauth/authorize',
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
  google: {
    clientId: 'YOUR_GOOGLE_CLIENT_ID',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/generative-language.retriever'],
  },
} as const

const REDIRECT_URI = 'maestro://oauth/callback'
const STORAGE_KEY_PREFIX = 'chat_oauth_'

// 진행 중인 PKCE 상태 메모리 저장 (완료 후 삭제)
const pendingPkce = new Map<ChatProvider, { verifier: string; state: string }>()

export class ChatOAuthService {
  // PKCE 플로우 시작
  async startOAuth(provider: ChatProvider): Promise<void> {
    const config = OAUTH_CONFIG[provider]
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    const state = crypto.randomBytes(16).toString('hex')

    pendingPkce.set(provider, { verifier, state })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: REDIRECT_URI,
      scope: config.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: `${provider}:${state}`,
    })

    await shell.openExternal(`${config.authEndpoint}?${params}`)
  }

  // protocol handler에서 호출 — authorization code 수신
  async handleCallback(url: string): Promise<{ provider: ChatProvider; success: boolean }> {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code')
    const stateParam = parsed.searchParams.get('state') ?? ''
    const colonIdx = stateParam.indexOf(':')
    const provider = stateParam.slice(0, colonIdx) as ChatProvider
    const state = stateParam.slice(colonIdx + 1)

    const pending = pendingPkce.get(provider)
    if (!pending || pending.state !== state || !code) {
      return { provider, success: false }
    }
    pendingPkce.delete(provider)

    try {
      const tokens = await this.exchangeCode(provider, code, pending.verifier)
      this.saveTokens(provider, tokens)
      return { provider, success: true }
    } catch {
      return { provider, success: false }
    }
  }

  private async exchangeCode(
    provider: ChatProvider,
    code: string,
    verifier: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const config = OAUTH_CONFIG[provider]
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: config.clientId,
      code_verifier: verifier,
    })

    return new Promise((resolve, reject) => {
      const url = new URL(config.tokenEndpoint)
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const json = JSON.parse(data) as {
                access_token: string
                refresh_token?: string
                expires_in?: number
              }
              resolve({
                accessToken: json.access_token,
                refreshToken: json.refresh_token,
                expiresIn: json.expires_in,
              })
            } catch {
              reject(new Error('Token parse failed'))
            }
          })
        },
      )
      req.on('error', reject)
      req.write(body.toString())
      req.end()
    })
  }

  saveTokens(
    provider: ChatProvider,
    tokens: { accessToken: string; refreshToken?: string; expiresIn?: number },
  ): void {
    if (!safeStorage.isEncryptionAvailable()) return
    const data = JSON.stringify({ ...tokens, savedAt: Date.now() })
    const encrypted = safeStorage.encryptString(data)
    const fs = require('node:fs') as typeof import('node:fs')
    const nodePath = require('node:path') as typeof import('node:path')
    const dir = nodePath.join(app.getPath('userData'), 'oauth-tokens')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(nodePath.join(dir, `${STORAGE_KEY_PREFIX}${provider}`), encrypted)
  }

  getTokens(
    provider: ChatProvider,
  ): { accessToken: string; refreshToken?: string; expiresIn?: number; savedAt?: number } | null {
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      const nodePath = require('node:path') as typeof import('node:path')
      const filePath = nodePath.join(
        app.getPath('userData'),
        'oauth-tokens',
        `${STORAGE_KEY_PREFIX}${provider}`,
      )
      if (!fs.existsSync(filePath)) return null
      const encrypted = fs.readFileSync(filePath)
      const decrypted = safeStorage.decryptString(encrypted)
      return JSON.parse(decrypted) as {
        accessToken: string
        refreshToken?: string
        expiresIn?: number
        savedAt?: number
      }
    } catch {
      return null
    }
  }

  deleteTokens(provider: ChatProvider): void {
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      const nodePath = require('node:path') as typeof import('node:path')
      const filePath = nodePath.join(
        app.getPath('userData'),
        'oauth-tokens',
        `${STORAGE_KEY_PREFIX}${provider}`,
      )
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
      // ignore
    }
  }

  isConnected(provider: ChatProvider): boolean {
    const tokens = this.getTokens(provider)
    if (!tokens) return false
    if (tokens.expiresIn && tokens.savedAt) {
      const expiresAt = tokens.savedAt + tokens.expiresIn * 1000
      return Date.now() < expiresAt - 60_000
    }
    return true
  }
}

export const chatOAuthService = new ChatOAuthService()
