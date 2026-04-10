import { Command } from 'commander';
import { createClient } from '../client';

export function createSessionCommand(): Command {
  const session = new Command('session').description('Session management');

  session.command('list').action(async () => {
    const client = createClient();
    const sessions = await client.session.listAll.query() as Array<{ id: string; status: string; name: string }>;
    sessions.forEach(s => console.log(`${s.id}\t${s.status}\t${s.name}`));
  });

  session
    .command('send <sessionId> <text>')
    .description('Send text to a specific session')
    .action(async (sessionId, text) => {
      const client = createClient();
      await client.session.sendInput.mutate({ sessionId, text: text + '\r' });
      console.log(`Text sent to session ${sessionId}`);
    });

  session
    .command('new')
    .description('Create a new session')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--name <name>', 'Session name', 'CLI Session')
    .action(async (opts) => {
      const client = createClient();
      const s = await client.session.create.mutate({
        name: opts.name,
        workspaceId: opts.workspace,
        agentId: opts.agent,
      });
      console.log(`Session created: ${(s as { id: string }).id}`);
    });

  session.command('stop <sessionId>').action(async (sessionId) => {
    const client = createClient();
    await client.session.stop.mutate({ sessionId });
    console.log(`Session ${sessionId} stopped`);
  });

  return session;
}
