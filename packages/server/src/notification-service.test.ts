import { describe, expect, it, vi } from 'vitest'

import { createUser, findNotificationDevicesByUserId, initDb, upsertNotificationDevice } from './db.js'
import {
  FcmPushProvider,
  ThreadNotificationService,
  createNotificationService,
} from './notification-service.js'

describe('createNotificationService', () => {
  it('returns null when the Firebase service account is not configured', () => {
    const db = initDb(':memory:')

    expect(
      createNotificationService(db, {
        firebaseServiceAccountBase64: '',
      }),
    ).toBeNull()
  })
})

describe('ThreadNotificationService', () => {
  it('removes stale device tokens when the provider marks them invalid', async () => {
    const db = initDb(':memory:')
    const user = createUser(db, {
      provider: 'github',
      providerId: 'notify-user',
      displayName: 'alice',
      avatarUrl: null,
    })

    upsertNotificationDevice(db, {
      installationId: 'device-1',
      userId: user.id,
      platform: 'android',
      provider: 'fcm',
      pushToken: 'bad-token',
    })

    const service = new ThreadNotificationService(db, {
      sendTurnCompletion: vi.fn().mockResolvedValue({
        ok: false,
        removeDevice: true,
      }),
    })

    await service.notifyTurnCompleted({
      userId: user.id,
      agentId: 'agent-1',
      runId: 'run-1',
      turnId: 'turn-1',
      repoPath: '/tmp/project',
      tool: 'codex',
      status: 'failed',
      summary: 'tool crashed',
      turnIndex: 1,
    })

    expect(findNotificationDevicesByUserId(db, user.id)).toEqual([])
  })
})

describe('FcmPushProvider', () => {
  it('sends a thread completion notification through the FCM HTTP v1 API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'projects/demo/messages/msg-1',
        }),
        text: async () => '',
      })

    const provider = new FcmPushProvider(
      {
        projectId: 'demo-project',
        clientEmail: 'webmux@demo-project.iam.gserviceaccount.com',
        privateKey:
          '-----BEGIN PRIVATE KEY-----\\nZmFrZS1rZXk=\\n-----END PRIVATE KEY-----\\n',
      },
      fetchMock as typeof fetch,
      async () => 'access-token',
    )

    const result = await provider.sendTurnCompletion(
      {
        installation_id: 'device-1',
        user_id: 'user-1',
        platform: 'android',
        provider: 'fcm',
        push_token: 'device-token',
        device_name: 'Pixel',
        created_at: 1,
        updated_at: 1,
      },
      {
        userId: 'user-1',
        agentId: 'agent-1',
        runId: 'run-1',
        turnId: 'turn-1',
        repoPath: '/tmp/project',
        tool: 'codex',
        status: 'success',
        summary: 'All done',
        turnIndex: 2,
      },
    )

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://fcm.googleapis.com/v1/projects/demo-project/messages:send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        }),
      }),
    )

    const [, request] = fetchMock.mock.calls[0] as [string, { body: string }]
    const payload = JSON.parse(request.body)
    expect(payload.message).toMatchObject({
      token: 'device-token',
      notification: {
        title: 'project completed',
      },
      data: {
        agentId: 'agent-1',
        runId: 'run-1',
        turnId: 'turn-1',
        status: 'success',
        turnIndex: '2',
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'thread_updates',
          tag: 'run-1',
        },
      },
    })
  })
})
