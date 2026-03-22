import type { Task, TaskMessage, TaskStep } from './contracts.js'

export type TimelineItem =
  | { type: 'message'; data: TaskMessage; timestamp: number }
  | { type: 'step-group'; data: TaskStep[]; timestamp: number }
  | { type: 'summary'; text: string; timestamp: number }
  | { type: 'error'; text: string; timestamp: number }

export function buildTaskTimeline(
  messages: TaskMessage[],
  steps: TaskStep[],
  task: Task,
): TimelineItem[] {
  const items: Array<{ type: 'message' | 'step' | 'summary' | 'error'; data: any; timestamp: number }> = []

  for (const msg of messages) {
    items.push({ type: 'message', data: msg, timestamp: msg.createdAt })
  }
  for (const step of steps) {
    items.push({ type: 'step', data: step, timestamp: step.createdAt })
  }
  if (task.summary) {
    items.push({ type: 'summary', data: task.summary, timestamp: task.updatedAt })
  }
  if (task.errorMessage) {
    items.push({ type: 'error', data: task.errorMessage, timestamp: task.updatedAt })
  }

  items.sort((a, b) => a.timestamp - b.timestamp)

  const result: TimelineItem[] = []
  let currentStepGroup: TaskStep[] = []
  let groupTimestamp = 0

  for (const item of items) {
    if (item.type === 'step') {
      if (currentStepGroup.length === 0) groupTimestamp = item.timestamp
      currentStepGroup.push(item.data)
    } else {
      if (currentStepGroup.length > 0) {
        result.push({ type: 'step-group', data: currentStepGroup, timestamp: groupTimestamp })
        currentStepGroup = []
      }
      if (item.type === 'message') {
        result.push({ type: 'message', data: item.data, timestamp: item.timestamp })
      } else if (item.type === 'summary') {
        result.push({ type: 'summary', text: item.data, timestamp: item.timestamp })
      } else if (item.type === 'error') {
        result.push({ type: 'error', text: item.data, timestamp: item.timestamp })
      }
    }
  }
  if (currentStepGroup.length > 0) {
    result.push({ type: 'step-group', data: currentStepGroup, timestamp: groupTimestamp })
  }

  return result
}
