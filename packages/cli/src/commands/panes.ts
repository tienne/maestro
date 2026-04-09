import { Command } from 'commander';
import { createClient } from '../client';

export function createPanesCommand(): Command {
  const panes = new Command('panes').description('Panes management');

  const terminal = panes.command('terminal');

  terminal.command('send <sessionId> <text>').action(async (sessionId, text) => {
    const client = createClient();
    await client.panes.terminalSend.mutate({ sessionId, text });
    console.log('Sent');
  });

  terminal.command('read <sessionId>').action(async (sessionId) => {
    const client = createClient();
    const result = await client.panes.terminalRead.query({ sessionId }) as { data?: string };
    process.stdout.write(result.data ?? '');
  });

  return panes;
}
