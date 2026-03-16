import path from 'node:path'

import type Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'

import type { NotificationService, TurnCompletionNotification } from './agent-hub.js'
import {
  deleteNotificationDevice,
  findNotificationDevicesByUserId,
} from './db.js'
import type { NotificationDeviceRow } from './db.js'

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FCM_CHANNEL_ID = 'thread_updates'

export interface FirebaseServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

export interface SendTurnCompletionResult {
  ok: boolean
  removeDevice?: boolean
}

export interface PushProvider {
  sendTurnCompletion(
    device: NotificationDeviceRow,
    notification: TurnCompletionNotification,
  ): Promise<SendTurnCompletionResult>
}

export function createNotificationService(
  db: Database.Database,
  options: {
    firebaseServiceAccountBase64?: string
  },
): NotificationService | null {
  const serviceAccount = parseFirebaseServiceAccount(options.firebaseServiceAccountBase64)
  if (!serviceAccount) {
    return null
  }

  return new ThreadNotificationService(db, new FcmPushProvider(serviceAccount))
}

export function parseFirebaseServiceAccount(base64Value?: string): FirebaseServiceAccount | null {
  if (!base64Value) {
    return null
  }

  try {
    const rawJson = Buffer.from(base64Value, 'base64').toString('utf8')
    const parsed = JSON.parse(rawJson) as {
      project_id?: string
      client_email?: string
      private_key?: string
    }

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null
    }

    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    }
  } catch {
    return null
  }
}

export class ThreadNotificationService implements NotificationService {
  constructor(
    private db: Database.Database,
    private provider: PushProvider,
  ) {}

  async notifyTurnCompleted(notification: TurnCompletionNotification): Promise<void> {
    const devices = findNotificationDevicesByUserId(this.db, notification.userId)
    for (const device of devices) {
      const result = await this.provider.sendTurnCompletion(device, notification)
      if (result.removeDevice) {
        deleteNotificationDevice(this.db, notification.userId, device.installation_id)
      }
    }
  }
}

export class FcmPushProvider implements PushProvider {
  private cachedAccessToken:
    | {
        token: string
        expiresAt: number
      }
    | null = null

  constructor(
    private serviceAccount: FirebaseServiceAccount,
    private fetchImpl: typeof fetch = fetch,
    private accessTokenFactory?: () => Promise<string>,
  ) {}

  async sendTurnCompletion(
    device: NotificationDeviceRow,
    notification: TurnCompletionNotification,
  ): Promise<SendTurnCompletionResult> {
    const accessToken = this.accessTokenFactory
      ? await this.accessTokenFactory()
      : await this.getAccessToken()

    const response = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: device.push_token,
            notification: buildNotificationCopy(notification),
            data: buildNotificationData(notification),
            android: {
              priority: 'high',
              notification: {
                channel_id: FCM_CHANNEL_ID,
                tag: notification.runId,
              },
            },
          },
        }),
      },
    )

    if (response.ok) {
      return { ok: true }
    }

    const bodyText = await response.text().catch(() => '')
    return {
      ok: false,
      removeDevice: shouldRemoveDeviceFromFcmResponse(bodyText),
    }
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt - 60_000 > now) {
      return this.cachedAccessToken.token
    }

    const issuedAt = Math.floor(now / 1000)
    const assertion = jwt.sign(
      {
        iss: this.serviceAccount.clientEmail,
        sub: this.serviceAccount.clientEmail,
        aud: OAUTH_TOKEN_URL,
        scope: FCM_SCOPE,
        iat: issuedAt,
        exp: issuedAt + 3600,
      },
      this.serviceAccount.privateKey,
      {
        algorithm: 'RS256',
      },
    )

    const tokenResponse = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '')
      throw new Error(`Failed to fetch Firebase access token: ${text || tokenResponse.statusText}`)
    }

    const body = (await tokenResponse.json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!body.access_token || !body.expires_in) {
      throw new Error('Firebase access token response did not include access_token and expires_in')
    }

    this.cachedAccessToken = {
      token: body.access_token,
      expiresAt: now + body.expires_in * 1000,
    }

    return body.access_token
  }
}

function buildNotificationCopy(notification: TurnCompletionNotification): {
  title: string
  body: string
} {
  const repoName = path.basename(notification.repoPath) || notification.repoPath
  const toolLabel = notification.tool === 'codex' ? 'Codex' : 'Claude'

  if (notification.status === 'success') {
    return {
      title: `${repoName} completed`,
      body:
        truncateNotificationText(notification.summary) ??
        `${toolLabel} turn ${notification.turnIndex} finished successfully.`,
    }
  }

  return {
    title: `${repoName} needs attention`,
    body:
      truncateNotificationText(notification.summary) ??
      `${toolLabel} turn ${notification.turnIndex} finished with status ${notification.status}.`,
  }
}

function buildNotificationData(
  notification: TurnCompletionNotification,
): Record<string, string> {
  return {
    type: 'thread-completed',
    agentId: notification.agentId,
    runId: notification.runId,
    turnId: notification.turnId,
    status: notification.status,
    turnIndex: String(notification.turnIndex),
  }
}

function truncateNotificationText(text?: string): string | undefined {
  if (!text) {
    return undefined
  }

  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= 140) {
    return compact
  }

  return `${compact.slice(0, 137)}...`
}

function shouldRemoveDeviceFromFcmResponse(bodyText: string): boolean {
  return bodyText.includes('UNREGISTERED') || bodyText.includes('registration-token-not-registered')
}
