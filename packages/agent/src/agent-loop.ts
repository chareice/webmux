import { randomUUID } from 'node:crypto'
import type { RunTool, StepType } from '@webmux/shared'
import { LlmClient, type ChatMessage, type ToolDefinition, type ToolCall } from './llm-client.js'

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
  onMessage: (message: { id: string; role: 'agent'; content: string; createdAt: number }) => void
  onWaiting?: () => void
  createRun: (tool: RunTool, prompt: string, repoPath: string, toolThreadId?: string) => Promise<{ summary: string; runId: string; toolThreadId?: string }>
  conversationHistory?: Array<{ role: 'agent' | 'user'; content: string }>
}

const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'run_claude_code',
      description: 'Start a Claude Code session. Use for ALL code-related work: reading code, analyzing projects, writing code, running tests, git operations, etc. Returns the session summary when complete.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed instructions for what Claude Code should do' },
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
      description: 'Start a Codex session. Alternative to Claude Code for code tasks. Returns the session summary when complete.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed instructions for what Codex should do' },
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
      description: 'Send a message to the user visible on the task card. Use for status updates, questions, or relaying results.',
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
      name: 'wait_for_user',
      description: 'Pause and wait for the user to reply. Use when you need clarification or input before proceeding.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Message to show the user explaining what you need' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Signal that the task work is done and provide a summary. The user will review and mark it complete.',
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
  private pendingWait = false
  private userReplyResolve: ((reply: string) => void) | null = null
  private toolThreadIds = new Map<string, string>() // tool name → threadId for session reuse

  constructor(private options: AgentLoopOptions) {
    this.client = new LlmClient(options.llmConfig)

    if (options.conversationHistory?.length) {
      // Build from conversation history for resumed/continued tasks
      this.messages = [
        { role: 'system', content: this.buildSystemPrompt() },
        // Include original task
        { role: 'user', content: `Task: ${options.title}\n\n${options.prompt}` },
        // Add conversation history
        ...options.conversationHistory.map(msg => ({
          role: (msg.role === 'agent' ? 'assistant' : 'user') as ChatMessage['role'],
          content: msg.content,
        })),
      ]
    } else {
      this.messages = [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: `Task: ${options.title}\n\n${options.prompt}` },
      ]
    }
  }

  private waitForUserReply(): Promise<string> {
    return new Promise((resolve) => {
      this.userReplyResolve = resolve
    })
  }

  public resolveUserReply(content: string): void {
    if (this.userReplyResolve) {
      this.userReplyResolve(content)
      this.userReplyResolve = null
    }
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
        // Send the content as a message and enter waiting state instead of auto-completing
        if (finishReason === 'stop' || !message.tool_calls?.length) {
          const content = message.content || 'I have completed my analysis.'
          this.options.onMessage({
            id: randomUUID(),
            role: 'agent',
            content,
            createdAt: Date.now(),
          })
          // Signal waiting — user decides when to mark complete or send follow-up
          this.options.onWaiting?.()
          // Wait for user reply (blocks until resolveUserReply is called)
          const reply = await this.waitForUserReply()
          // Add user reply as a user message and continue the loop
          this.messages.push({ role: 'user', content: reply })
          continue
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
          if (this.aborted) return
        }

        // If a tool triggered a wait (complete_task or wait_for_user),
        // block here until the user replies, then continue the loop
        if (this.pendingWait) {
          this.pendingWait = false
          const reply = await this.waitForUserReply()
          this.messages.push({ role: 'user', content: reply })
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
    return `You are a task orchestrator for a software project. You coordinate code agents (Claude Code / Codex) to complete tasks. You do NOT read code or run commands yourself — delegate ALL code-related work to code agents.

Your role:
- Understand what the user needs
- Delegate code work to run_claude_code or run_codex with clear, detailed instructions
- Relay results and communicate with the user
- Coordinate multi-step workflows

Tools:
- run_claude_code: Delegate ANY code-related work — reading code, analyzing projects, writing code, running tests, git operations, debugging, etc. Give detailed instructions.
- run_codex: Alternative code agent. Use when you want a second opinion or prefer Codex.
- reply_message: Send a message to the user (status updates, questions, relaying results).
- wait_for_user: Pause and wait for user input when you need clarification.
- complete_task: Signal you're done and provide a summary.

Project context:
- Repository path: ${this.options.repoPath}
- Default coding tool: ${this.options.defaultTool}

Important:
- ALWAYS delegate code work to code agents. Never try to analyze code or run commands yourself.
- Give code agents detailed, specific instructions so they can work independently.
- After a code agent finishes, relay the key results to the user via reply_message.
- Call complete_task when all work is done. The user will review and decide when to mark complete.`
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

    // Report step started (include full prompt as detail for code tools)
    this.options.onStepUpdate({
      id: stepId,
      type: stepType,
      label: this.toolToLabel(name, args),
      status: 'running',
      detail: (name === 'run_claude_code' || name === 'run_codex') ? args.prompt as string : undefined,
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
        const threadId = this.toolThreadIds.get('claude')
        const result = await this.options.createRun('claude', prompt, dir, threadId)
        if (result.toolThreadId) {
          this.toolThreadIds.set('claude', result.toolThreadId)
        }
        return result.summary || `Claude Code session completed (run: ${result.runId})`
      }

      case 'run_codex': {
        const prompt = args.prompt as string
        const dir = (args.directory as string) || this.options.repoPath
        const threadId = this.toolThreadIds.get('codex')
        const result = await this.options.createRun('codex', prompt, dir, threadId)
        if (result.toolThreadId) {
          this.toolThreadIds.set('codex', result.toolThreadId)
        }
        return result.summary || `Codex session completed (run: ${result.runId})`
      }

      case 'reply_message': {
        const message = args.message as string
        this.options.onMessage({
          id: randomUUID(),
          role: 'agent',
          content: message,
          createdAt: Date.now(),
        })
        return 'Message sent to user.'
      }

      case 'wait_for_user': {
        const prompt = args.prompt as string
        // Send the prompt as an agent message
        this.options.onMessage({
          id: randomUUID(),
          role: 'agent',
          content: prompt,
          createdAt: Date.now(),
        })
        // Signal waiting — actual wait happens in run() loop after step completes
        this.options.onWaiting?.()
        this.pendingWait = true
        return 'Waiting for user response.'
      }

      case 'complete_task': {
        const summary = args.summary as string
        // Send summary as an agent message instead of completing the task
        this.options.onMessage({
          id: randomUUID(),
          role: 'agent',
          content: summary,
          createdAt: Date.now(),
        })
        // Signal waiting — actual wait happens in run() loop after step completes
        this.options.onWaiting?.()
        this.pendingWait = true
        return 'Summary sent. Waiting for user response.'
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
      case 'wait_for_user':
        return 'message'
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
      case 'wait_for_user':
        return `Waiting for user: ${(args.prompt as string).slice(0, 60)}`
      case 'complete_task':
        return 'Complete task'
      default:
        return toolName
    }
  }
}
