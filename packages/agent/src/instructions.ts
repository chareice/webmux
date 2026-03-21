import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { RunTool } from '@webmux/shared'

const TOOL_PATHS: Record<RunTool, string> = {
  claude: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  codex: path.join(os.homedir(), '.codex', 'AGENTS.md'),
}

export async function readInstructions(tool: RunTool): Promise<string | null> {
  const filePath = TOOL_PATHS[tool]
  try {
    return await readFile(filePath, 'utf-8')
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function writeInstructions(tool: RunTool, content: string): Promise<void> {
  const filePath = TOOL_PATHS[tool]
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}
