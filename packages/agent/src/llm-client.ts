export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON Schema
  }
}

export interface LlmClientConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
}

export class LlmClient {
  constructor(private config: LlmClientConfig) {}

  async chatCompletion(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<{ message: ChatMessage; finishReason: string }> {
    // Build the URL - handle trailing slash
    const baseUrl = this.config.apiBaseUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/chat/completions`

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    }
    if (tools?.length) {
      body.tools = tools
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: ChatMessage
        finish_reason: string
      }>
    }

    const choice = data.choices[0]
    if (!choice) {
      throw new Error('LLM API returned no choices')
    }

    return {
      message: choice.message,
      finishReason: choice.finish_reason,
    }
  }
}
