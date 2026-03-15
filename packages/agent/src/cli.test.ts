import { beforeEach, describe, expect, it, vi } from 'vitest'

const installServiceMock = vi.fn()

vi.mock('node-pty', () => {
  throw new Error('node-pty should not be imported for service commands')
})

vi.mock('./credentials.js', () => ({
  loadCredentials: () => ({
    serverUrl: 'https://webmux.example.com',
    agentId: 'agent-123',
    agentSecret: 'secret-123',
    name: 'test-agent',
  }),
  saveCredentials: vi.fn(),
  credentialsPath: () => '/tmp/webmux-agent-creds.json',
}))

vi.mock('./service.js', () => ({
  SERVICE_NAME: 'webmux-agent',
  installService: installServiceMock,
  readInstalledServiceConfig: () => null,
  servicePath: () => '/tmp/webmux-agent.service',
  uninstallService: vi.fn(),
  upgradeService: vi.fn(),
}))

vi.mock('./version.js', () => ({
  AGENT_PACKAGE_NAME: '@webmux/agent',
  AGENT_VERSION: '0.2.0',
}))

describe('cli service commands', () => {
  beforeEach(() => {
    installServiceMock.mockReset()
  })

  it('does not load node-pty for service install', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { createProgram } = await import('./cli.js')
      await createProgram().parseAsync(['service', 'install'], { from: 'user' })

      expect(installServiceMock).toHaveBeenCalledWith({
        agentName: 'test-agent',
        packageName: '@webmux/agent',
        version: '0.2.0',
        autoUpgrade: true,
      })
    } finally {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
