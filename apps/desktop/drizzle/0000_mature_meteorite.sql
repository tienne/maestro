CREATE TABLE `agent_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`agent_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`initial_command` text DEFAULT '' NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`script_path` text,
	`script_content` text
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text DEFAULT 'Default' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
CREATE TABLE `env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_vars_repository_key_uq` ON `env_vars` (`repository_id`,`key`);--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`error_msg` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_url_unique` ON `mcp_servers` (`url`);--> statement-breakpoint
CREATE TABLE `panes` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text NOT NULL,
	`type` text DEFAULT 'terminal' NOT NULL,
	`session_id` text,
	`position` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`layout_id`) REFERENCES `tiled_layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text DEFAULT '0.0.0' NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`loaded_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_path_unique` ON `plugins` (`path`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`repository_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `prompt_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prompt_history_session` ON `prompt_history` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`branch_prefix` text DEFAULT '' NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`worktree_base_path` text DEFAULT '' NOT NULL,
	`setup_script` text DEFAULT '' NOT NULL,
	`teardown_script` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_path_unique` ON `repositories` (`path`);--> statement-breakpoint
CREATE TABLE `session_archives` (
	`session_id` text PRIMARY KEY NOT NULL,
	`session_name` text DEFAULT '' NOT NULL,
	`log_path` text NOT NULL,
	`archived_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_session_archives_date` ON `session_archives` (`archived_at`);--> statement-breakpoint
CREATE TABLE `session_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_session_costs_session` ON `session_costs` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_labels` (
	`session_id` text NOT NULL,
	`label_name` text NOT NULL,
	`label_color` text DEFAULT '#6366f1' NOT NULL,
	PRIMARY KEY(`session_id`, `label_name`)
);
--> statement-breakpoint
CREATE TABLE `session_scrollbacks` (
	`session_id` text PRIMARY KEY NOT NULL,
	`data` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`pid` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`depends_on_session_id` text,
	`context_source_session_id` text,
	`last_exit_code` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_task_id` text,
	`title` text NOT NULL,
	`prd` text,
	`spec` text,
	`reference_files` text,
	`acceptance_criteria` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`assigned_agent_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text DEFAULT 'human' NOT NULL,
	`workspace_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `tiled_layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`mosaic_state` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhook_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`status_code` integer,
	`response_body` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_webhook` ON `webhook_logs` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`git_head` text DEFAULT '' NOT NULL,
	`setup_script` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_snapshots_ws` ON `workspace_snapshots` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`agent_type` text DEFAULT '' NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`setup_script` text DEFAULT '' NOT NULL,
	`teardown_script` text DEFAULT '' NOT NULL,
	`branch_pattern` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repository_id` text NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`hook_on_session_start` text DEFAULT '' NOT NULL,
	`hook_on_agent_complete` text DEFAULT '' NOT NULL,
	`hook_on_error` text DEFAULT '' NOT NULL,
	`task_id` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
