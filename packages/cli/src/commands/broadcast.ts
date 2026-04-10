import { Command } from 'commander';
import { readServerConfig } from '../config';

export function createBroadcastCommand(): Command {
  const broadcast = new Command('broadcast')
    .description('Broadcast text to all running sessions')
    .argument('<text>', 'Text to broadcast')
    .option('--sessions <ids>', 'Comma-separated session IDs (optional)')
    .action(async (text, opts) => {
      const config = readServerConfig();
      const body: { text: string; sessionIds?: string[] } = { text: text + '\r' };
      if (opts.sessions) {
        body.sessionIds = (opts.sessions as string).split(',').map((s: string) => s.trim());
      }

      const res = await fetch(`http://127.0.0.1:${config.port}/api/remote/sessions/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json() as { ok: boolean; sent: number; errors: string[] };
      console.log(`Broadcast sent to ${data.sent} sessions`);
      if (data.errors.length > 0) {
        console.error('Errors:', data.errors.join(', '));
      }
    });

  return broadcast;
}
