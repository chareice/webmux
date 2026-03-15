import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { browseRepositories } from './repositories.js'

describe('browseRepositories', () => {
  it('lists directories and git repositories for the requested path', async () => {
    const rootPath = mkdtempSync(path.join(os.tmpdir(), 'webmux-repositories-'))
    const projectsPath = path.join(rootPath, 'projects')
    const repoPath = path.join(projectsPath, 'webmux')
    const docsPath = path.join(projectsPath, 'notes')

    mkdirSync(path.join(repoPath, '.git'), { recursive: true })
    mkdirSync(docsPath, { recursive: true })
    writeFileSync(path.join(projectsPath, 'README.txt'), 'ignore me')

    const result = await browseRepositories({
      rootPath,
      requestedPath: projectsPath,
    })

    expect(result.currentPath).toBe(projectsPath)
    expect(result.parentPath).toBe(rootPath)
    expect(result.entries).toEqual([
      {
        kind: 'repository',
        name: 'webmux',
        path: repoPath,
      },
      {
        kind: 'directory',
        name: 'notes',
        path: docsPath,
      },
    ])
  })

  it('rejects paths outside the allowed root', async () => {
    const rootPath = mkdtempSync(path.join(os.tmpdir(), 'webmux-repositories-'))

    await expect(
      browseRepositories({
        rootPath,
        requestedPath: path.resolve(rootPath, '../outside'),
      }),
    ).rejects.toThrow('Requested path is outside the allowed root')
  })
})
