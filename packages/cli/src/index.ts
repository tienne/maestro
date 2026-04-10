#!/usr/bin/env node
import { Command } from 'commander';
import { createWorkspaceCommand } from './commands/workspace';
import { createAgentCommand } from './commands/agent';
import { createSessionCommand } from './commands/session';
import { createPanesCommand } from './commands/panes';
import { createUiCommand } from './commands/ui';
import { createBroadcastCommand } from './commands/broadcast';

const program = new Command()
  .name('maestro')
  .description('Maestro — AI Agent Orchestration CLI')
  .version('0.1.0');

program
  .addCommand(createWorkspaceCommand())
  .addCommand(createAgentCommand())
  .addCommand(createSessionCommand())
  .addCommand(createPanesCommand())
  .addCommand(createUiCommand())
  .addCommand(createBroadcastCommand());

program.parse();
