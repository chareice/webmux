import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { RunTool, StepType } from '@webmux/shared'
import { LlmClient, type ChatMessage, type ToolDefinition, type ToolCall } from './llm-client.js'

const execFileAsync = promisify(execFile)

export interface StepUpdate {
  id: string
  type: StepType
  label: string
  status: 'running' | 'completed' | 'failed'
  detail?: string
  toolName: string
  runId?: string
  durationMs?: number
  createdAt: number
  completedAt?: number
}

export interface AgentLoopOptions {
  taskId: string
  title: string
  prompt: string
  repoPath: string
  defaultTool: RunTool
  llmConfig: { apiBaseUrl: string; apiKey: string; model: string }
  onStepUpdate: (step: StepUpdate) => void
  onTaskComplete: (summary: string) => void
  onTaskFailed: (error: string) => void
  createRun: (tool: RunTool, prompt: string, repoPath: string) => Promise<{ summary: string; runId: string }>
}

const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_claude_code',
      description: 'Start a Claude Code session to implement code changes. Returns the session summary when complete.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What Claude Code should do' },
          directory: { type: 'string', description: 'Working directory (defaults to repo path)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_codex',
      description: 'Start a Codex session for code review or implementation. Returns the session summary when complete.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What Codex should do' },
          directory: { type: 'string', description: 'Working directory (defaults to repo path)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_message',
      description: 'Send a message to the user visible on the task card. Use for status updates or questions.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message content' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the repository.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to repo root' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the repository directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark the task as complete. Call this when all work is done.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary of what was accomplished. Mention files changed, branch name, key decisions.' },
        },
        required: ['summary'],
      },
    },
  },
]

export class AgentLoop {
  private client: LlmClient
  private messages: ChatMessage[]
  private aborted = false

  constructor(private options: AgentLoopOptions) {
    this.client = new LlmClient(options.llmConfig)
    this.messages = [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: `Task: ${options.title}\n\n${options.prompt}` },
    ]
  }

  async run(): Promise<void> {
    try {
      while (!this.aborted) {
        const { message, finishReason } = await this.client.chatCompletion(
          this.messages,
          AGENT_TOOLS,
        )

        this.messages.push(message)

        // If LLM responded with just text (no tool calls), treat as implicit completion
        if (finishReason === 'stop' || !message.tool_calls?.length) {
          const summary = message.content || 'Task completed.'
          this.options.onTaskComplete(summary)
          return
        }

        // Process each tool call
        for (const toolCall of message.tool_calls) {
          if (this.aborted) break
          const result = await this.executeTool(toolCall)
          this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          })
          // If complete_task was called, we're done
          if (this.aborted) return
        }
      }
    } catch (err) {
      this.options.onTaskFailed((err as Error).message)
    }
  }

  abort(): void {
    this.aborted = true
  }

  private buildSystemPrompt(): string {
    return `You are a task orchestrator for a software project. You receive a task and must decide how to complete it using the available tools.

Guidelines:
- Analyze the task before jumping into execution.
- Use run_claude_code for writing or modifying code.
- Use run_codex for code review or alternative implementations.
- Use read_file to quickly inspect files without starting a full session.
- Use run_command for quick checks (git status, running tests, etc.).
- Use reply_message to communicate findings or status to the user.
- When all work is done, call complete_task with a detailed summary.

Project context:
- Repository path: ${this.options.repoPath}
- Default coding tool: ${this.options.defaultTool}

Important:
- You MUST call complete_task when you are finished. Do not just stop responding.
- Be thorough but efficient. Don't do unnecessary work.
- If the task is a simple question, use read_file/run_command to find the answer and reply_message to respond, then complete_task.
- If the task requires coding, use run_claude_code or run_codex as appropriate.`
  }

  private async executeTool(toolCall: ToolCall): Promise<string> {
    const { name, arguments: argsStr } = toolCall.function
    let args: Record<string, unknown>
    try {
      args = JSON.parse(argsStr)
    } catch {
      return `Error: Failed to parse tool arguments: ${argsStr}`
    }

    const stepId = randomUUID()
    const stepStart = Date.now()
    const stepType = this.toolToStepType(name)

    // Report step started
    this.options.onStepUpdate({
      id: stepId,
      type: stepType,
      label: this.toolToLabel(name, args),
      status: 'running',
      toolName: name,
      createdAt: stepStart,
    })

    try {
      const result = await this.executeToolInner(name, args)

      // Report step completed
      this.options.onStepUpdate({
        id: stepId,
        type: stepType,
        label: this.toolToLabel(name, args),
        status: 'completed',
        toolName: name,
        detail: typeof result === 'string' ? result.slice(0, 500) : undefined,
        durationMs: Date.now() - stepStart,
        createdAt: stepStart,
        completedAt: Date.now(),
      })

      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (err) {
      const errorMsg = (err as Error).message

      // Report step failed
      this.options.onStepUpdate({
        id: stepId,
        type: stepType,
        label: this.toolToLabel(name, args),
        status: 'failed',
        toolName: name,
        detail: errorMsg,
        durationMs: Date.now() - stepStart,
        createdAt: stepStart,
        completedAt: Date.now(),
      })

      return `Error: ${errorMsg}`
    }
  }

  private async executeToolInner(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'run_claude_code': {
        const prompt = args.prompt as string
        const dir = (args.directory as string) || this.options.repoPath
        const { summary, runId } = await this.options.createRun('claude', prompt, dir)
        return summary || `Claude Code session completed (run: ${runId})`
      }

      case 'run_codex': {
        const prompt = args.prompt as string
        const dir = (args.directory as string) || this.options.repoPath
        const { summary, runId } = await this.options.createRun('codex', prompt, dir)
        return summary || `Codex session completed (run: ${runId})`
      }

      case 'reply_message': {
        const message = args.message as string
        return `Message sent to user: ${message}`
      }

      case 'read_file': {
        const filePath = args.path as string
        const fullPath = resolve(this.options.repoPath, filePath)
        const content = await readFile(fullPath, 'utf-8')
        // Truncate very large files
        if (content.length > 10000) {
          return content.slice(0, 10000) + '\n... (truncated)'
        }
        return content
      }

      case 'run_command': {
        const command = args.command as string
        try {
          const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
            cwd: this.options.repoPath,
            timeout: 60000, // 60s timeout
            maxBuffer: 1024 * 1024, // 1MB
          })
          return (stdout + (stderr ? '\nSTDERR: ' + stderr : '')).trim()
        } catch (err: unknown) {
          const execErr = err as { code?: number; stdout?: string; stderr?: string }
          return `Command failed (exit ${execErr.code}): ${execErr.stdout || ''}\n${execErr.stderr || ''}`
        }
      }

      case 'complete_task': {
        const summary = args.summary as string
        this.options.onTaskComplete(summary)
        this.aborted = true
        return 'Task marked as complete.'
      }

      default:
        return `Unknown tool: ${name}`
    }
  }

  private toolToStepType(toolName: string): StepType {
    switch (toolName) {
      case 'run_claude_code':
      case 'run_codex':
        return 'code'
      case 'reply_message':
        return 'message'
      case 'run_command':
        return 'command'
      case 'read_file':
        return 'read_file'
      case 'complete_task':
        return 'think'
      default:
        return 'think'
    }
  }

  private toolToLabel(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'run_claude_code':
        return `Claude Code: ${(args.prompt as string).slice(0, 80)}`
      case 'run_codex':
        return `Codex: ${(args.prompt as string).slice(0, 80)}`
      case 'reply_message':
        return `Message: ${(args.message as string).slice(0, 80)}`
      case 'read_file':
        return `Read: ${args.path as string}`
      case 'run_command':
        return `Command: ${(args.command as string).slice(0, 80)}`
      case 'complete_task':
        return 'Complete task'
      default:
        return toolName
    }
  }
}
