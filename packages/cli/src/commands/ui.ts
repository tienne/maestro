import { Command } from 'commander';
import { createClient } from '../client';

export function createUiCommand(): Command {
  const ui = new Command('ui').description('Desktop UI control');

  ui
    .command('focus')
    .option('--target <window>', 'Window to focus', 'main')
    .action(async (opts) => {
      const client = createClient();
      await client.ui.focus.mutate({ target: opts.target });
      console.log('Focused');
    });

  ui
    .command('sidebar')
    .option('--close', 'Close the sidebar')
    .option('--side <side>', 'left or right', 'left')
    .action(async (opts) => {
      const client = createClient();
      await client.ui.sidebar.mutate({
        open: !opts.close,
        side: opts.side as 'left' | 'right',
      });
      console.log('Sidebar toggled');
    });

  ui
    .command('tabs')
    .requiredOption('--tab <name>', 'Active tab name')
    .option('--panel <panel>', 'Panel: terminal | git | mcp')
    .action(async (opts) => {
      const client = createClient();
      await client.ui.tabs.mutate({
        activeTab: opts.tab,
        panel: opts.panel as 'terminal' | 'git' | 'mcp' | undefined,
      });
      console.log('Tabs updated');
    });

  return ui;
}
