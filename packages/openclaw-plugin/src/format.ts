import type { Run, RunTurnDetail, RunTimelineEvent } from "./types.js";

export function formatRunSummary(run: Run): string {
  const status = run.status.toUpperCase();
  const tool = run.tool;
  const repo = run.repoPath;
  const summary = run.summary ? `\n\nSummary: ${run.summary}` : "";
  return `**${status}** | ${tool} on \`${repo}\` (branch: ${run.branch})${summary}`;
}

export function formatTimeline(turns: RunTurnDetail[]): string {
  const parts: string[] = [];
  for (const turn of turns) {
    parts.push(`### Turn ${turn.index + 1} (${turn.status})`);
    if (turn.prompt) parts.push(`> ${turn.prompt}`);
    for (const item of turn.items) {
      parts.push(formatTimelineEvent(item));
    }
    if (turn.summary) parts.push(`**Summary:** ${turn.summary}`);
  }
  return parts.join("\n\n");
}

function formatTimelineEvent(event: RunTimelineEvent): string {
  switch (event.type) {
    case "message":
      return `**[${event.role}]** ${event.text}`;
    case "command":
      return `\`\`\`\n$ ${event.command}\n${event.output}\n\`\`\`\nExit: ${event.exitCode ?? "running"}`;
    case "activity":
      return `_${event.label}_${event.detail ? `: ${event.detail}` : ""}`;
    case "todo":
      return event.items.map((i) => `- [${i.status === "completed" ? "x" : " "}] ${i.text}`).join("\n");
  }
}
