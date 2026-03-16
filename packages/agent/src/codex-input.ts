import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'

import type { RunImageAttachmentUpload } from '@webmux/shared'

import type { CodexInput } from './codex-client.js'

export async function prepareCodexInput(
  prompt: string,
  attachments: RunImageAttachmentUpload[],
): Promise<{ input: CodexInput; cleanup: () => Promise<void> }> {
  if (attachments.length === 0) {
    return {
      input: prompt,
      cleanup: async () => {},
    }
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'webmux-codex-images-'))
  const blocks: Exclude<CodexInput, string> = []
  const trimmedPrompt = prompt.trim()

  if (trimmedPrompt) {
    blocks.push({
      type: 'text',
      text: trimmedPrompt,
    })
  }

  for (const attachment of attachments) {
    const extension = chooseAttachmentExtension(attachment)
    const filePath = path.join(tempDir, `${attachment.id}${extension}`)
    await writeFile(filePath, Buffer.from(attachment.base64, 'base64'))
    blocks.push({
      type: 'local_image',
      path: filePath,
    })
  }

  return {
    input: blocks,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true })
    },
  }
}

function chooseAttachmentExtension(attachment: RunImageAttachmentUpload): string {
  const fromName = path.extname(attachment.name).trim()
  if (fromName) {
    return fromName
  }

  switch (attachment.mimeType) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return '.img'
  }
}
