import { Command } from 'commander';
import { createClient } from '../client';

export function createAgentCommand(): Command {
  const agent = new Command('agent').description('AI agent management');

  agent
    .command('start')
    .description('Start an agent session')
    .requiredOption('--agent <type>', 'Agent type: claude-code, gemini, codex, opencode')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--prompt <text>', 'Initial prompt')
    .action(async (opts) => {
      const client = createClient();
      // 1. Create session
      const session = await client.session.create.mutate({
        name: `${opts.agent}-${Date.now()}`,
        workspaceId: opts.workspace,
        agentId: `builtin-${opts.agent.replace('claude-code', 'claude')}`,
      }) as { id: string };
      // 2. Launch (PTY)
      await client.session.launch.mutate({ sessionId: session.id, cols: 220, rows: 50 });
      console.log(`Session started: ${session.id}`);
    });

  agent
    .command('stop <sessionId>')
    .description('Stop an agent session')
    .action(async (sessionId) => {
      const client = createClient();
      await client.session.stop.mutate({ sessionId });
      console.log(`Session ${sessionId} stopped`);
    });

  agent
    .command('list')
    .description('List running sessions')
    .action(async () => {
      const client = createClient();
      const sessions = await client.session.listAll.query() as Array<{ id: string; status: string; name: string }>;
      sessions.forEach(s => console.log(`${s.id}\t${s.status}\t${s.name}`));
    });

  return agent;
}
