import { Command } from 'commander';
import { createClient } from '../client';

export function createSessionCommand(): Command {
  const session = new Command('session').description('Session management');

  session.command('list').action(async () => {
    const client = createClient();
    const sessions = await client.session.listAll.query() as Array<{ id: string; status: string; name: string }>;
    sessions.forEach(s => console.log(`${s.id}\t${s.status}\t${s.name}`));
  });

  session.command('stop <sessionId>').action(async (sessionId) => {
    const client = createClient();
    await client.session.stop.mutate({ sessionId });
    console.log(`Session ${sessionId} stopped`);
  });

  return session;
}
