import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { RepositoryBrowseResponse, RepositoryEntry } from '@webmux/shared'

interface BrowseRepositoriesOptions {
  rootPath: string
  requestedPath?: string
}

export async function browseRepositories(
  options: BrowseRepositoriesOptions,
): Promise<RepositoryBrowseResponse> {
  const rootPath = path.resolve(options.rootPath)
  const currentPath = resolveRequestedPath(rootPath, options.requestedPath)
  const dirents = await readdir(currentPath, { withFileTypes: true })

  const entries = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory())
      .map(async (dirent) => classifyEntry(currentPath, dirent.name)),
  )

  return {
    currentPath,
    parentPath: currentPath === rootPath ? null : path.dirname(currentPath),
    entries: entries.sort(compareRepositoryEntries),
  }
}

async function classifyEntry(basePath: string, name: string): Promise<RepositoryEntry> {
  const entryPath = path.join(basePath, name)
  const gitPath = path.join(entryPath, '.git')

  try {
    const gitStat = await stat(gitPath)
    if (gitStat.isDirectory() || gitStat.isFile()) {
      return {
        kind: 'repository',
        name,
        path: entryPath,
      }
    }
  } catch {
    return {
      kind: 'directory',
      name,
      path: entryPath,
    }
  }

  return {
    kind: 'directory',
    name,
    path: entryPath,
  }
}

function resolveRequestedPath(rootPath: string, requestedPath?: string): string {
  const candidatePath = path.resolve(requestedPath ?? rootPath)
  const relativePath = path.relative(rootPath, candidatePath)

  if (
    relativePath !== '' &&
    (relativePath.startsWith('..') || path.isAbsolute(relativePath))
  ) {
    throw new Error('Requested path is outside the allowed root')
  }

  return candidatePath
}

function compareRepositoryEntries(left: RepositoryEntry, right: RepositoryEntry): number {
  const kindOrder = repositoryKindOrder(left.kind) - repositoryKindOrder(right.kind)
  if (kindOrder !== 0) {
    return kindOrder
  }

  const hiddenOrder = Number(left.name.startsWith('.')) - Number(right.name.startsWith('.'))
  if (hiddenOrder !== 0) {
    return hiddenOrder
  }

  return left.name.localeCompare(right.name)
}

function repositoryKindOrder(kind: RepositoryEntry['kind']): number {
  return kind === 'repository' ? 0 : 1
}
