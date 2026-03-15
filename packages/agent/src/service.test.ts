import { describe, expect, it } from 'vitest'

import { renderServiceUnit } from './service.js'

describe('renderServiceUnit', () => {
  it('pins the service to a managed release and enables service mode upgrades', () => {
    const unit = renderServiceUnit({
      agentName: 'my-nas',
      homeDir: '/home/alice',
      nodePath: '/usr/bin/node',
      cliPath: '/home/alice/.webmux/releases/0.1.5/node_modules/@webmux/agent/dist/cli.js',
      autoUpgrade: true,
      pathEnv: '/usr/bin:/bin',
    })

    expect(unit).toContain('ExecStart=/usr/bin/node /home/alice/.webmux/releases/0.1.5/node_modules/@webmux/agent/dist/cli.js start')
    expect(unit).toContain('Environment=WEBMUX_AGENT_SERVICE=1')
    expect(unit).toContain('Environment=WEBMUX_AGENT_AUTO_UPGRADE=1')
    expect(unit).not.toContain('ExecStartPre=')
    expect(unit).not.toContain('@latest')
  })
})
