import { Agent, AgentNotFoundError, CursorAgentError, type AgentOptions, type SDKMessage } from "@cursor/sdk";
import { ensureRipgrep } from "./ripgrep.js";
import { createTools } from "./tools.js";

export async function runCampaignAgent(options: {
  root: string;
  prompt: string;
  resumeId?: string;
  name: string;
  onAgentId?: (agentId: string) => void;
}): Promise<number> {
  ensureRipgrep();

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.error("CURSOR_API_KEY is not set. Add it to .env (see .env.example) and run again.");
    return 1;
  }

  const model = process.env.CURSOR_MODEL?.trim() || "composer-2.5";
  const host = { agentId: "" };
  const agentOptions: AgentOptions = {
    apiKey,
    model: { id: model },
    name: options.name,
    disallowedTools: ["shell", "task"],
    local: {
      cwd: options.root,
      customTools: createTools(options.root, host),
    },
  };

  try {
    await using agent = await openAgent(agentOptions, options.resumeId);
    host.agentId = agent.agentId;
    options.onAgentId?.(agent.agentId);
    console.error(`agent ${agent.agentId}`);

    const run = await agent.send(options.prompt);
    console.error(`run ${run.id}`);

    let wroteText = false;
    try {
      if (run.supports("stream")) {
        for await (const event of run.stream()) {
          wroteText = printEvent(event) || wroteText;
        }
      }
    } catch (err) {
      if (run.status === "running" && run.supports("wait")) {
        await run.wait().catch(() => undefined);
      }
      throw err;
    }

    const result = await run.wait();
    if (!wroteText && result.result) process.stdout.write(result.result + "\n");
    if (result.status === "error") {
      console.error(`run failed: ${result.id}${result.error?.message ? ` ${result.error.message}` : ""}`);
      return 2;
    }
    if (result.status === "cancelled") {
      console.error(`run cancelled: ${result.id}`);
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof CursorAgentError) {
      console.error(`startup failed: ${err.message}, retryable=${err.isRetryable}`);
      return 1;
    }
    throw err;
  }
}

async function openAgent(options: AgentOptions, resumeId?: string) {
  if (!resumeId) return Agent.create(options);
  try {
    return await Agent.resume(resumeId, options);
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      console.error(`Saved agent ${resumeId} is gone. Starting a new one with the same tools.`);
      return Agent.create(options);
    }
    throw err;
  }
}

function printEvent(event: SDKMessage): boolean {
  if (event.type === "assistant") {
    let wrote = false;
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        process.stdout.write(block.text);
        wrote = true;
      }
    }
    return wrote;
  }
  if (event.type === "tool_call" && event.status === "running") {
    process.stderr.write(`\n→ ${event.name}\n`);
  } else if (event.type === "tool_call" && event.status === "error") {
    process.stderr.write(`\n${event.name} failed\n`);
  } else if (event.type === "status" && event.status === "ERROR" && event.message) {
    process.stderr.write(`\n${event.message}\n`);
  }
  return false;
}
