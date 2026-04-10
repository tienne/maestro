/**
 * M10-01: 플러그인 매니저.
 * maestro-plugin.json manifest를 가진 Node.js 패키지를 로드/언로드한다.
 *
 * 확장 포인트 인터페이스:
 * - registerAgentType(config) — 커스텀 에이전트 타입
 * - registerPanelTab(config) — 우측 패널 탭
 * - registerCommand(config) — 커맨드 팔레트 항목
 */

import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
}

export interface AgentTypeConfig {
  name: string;
  command: string;
  args: string[];
}

export interface PanelTabConfig {
  id: string;
  label: string;
  component: string; // 렌더러에서 동적 로드할 컴포넌트 경로
}

export interface CommandConfig {
  id: string;
  label: string;
  action: () => void;
}

export interface PluginContext {
  registerAgentType: (config: AgentTypeConfig) => void;
  registerPanelTab: (config: PanelTabConfig) => void;
  registerCommand: (config: CommandConfig) => void;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  agentTypes: AgentTypeConfig[];
  panelTabs: PanelTabConfig[];
  commands: CommandConfig[];
}

class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();

  /**
   * 플러그인 디렉토리에서 manifest를 읽고 entry 파일을 실행한다.
   */
  load(pluginPath: string): LoadedPlugin {
    const manifestPath = path.join(pluginPath, 'maestro-plugin.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No maestro-plugin.json found at ${pluginPath}`);
    }

    const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!manifest.name || !manifest.version || !manifest.entry) {
      throw new Error('Invalid manifest: name, version, and entry are required');
    }

    const entryPath = path.join(pluginPath, manifest.entry);
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Plugin entry file not found: ${entryPath}`);
    }

    const plugin: LoadedPlugin = {
      manifest,
      path: pluginPath,
      agentTypes: [],
      panelTabs: [],
      commands: [],
    };

    const ctx: PluginContext = {
      registerAgentType: (config) => {
        plugin.agentTypes.push(config);
        log.info(`[PluginManager] Registered agent type: ${config.name}`);
      },
      registerPanelTab: (config) => {
        plugin.panelTabs.push(config);
        log.info(`[PluginManager] Registered panel tab: ${config.label}`);
      },
      registerCommand: (config) => {
        plugin.commands.push(config);
        log.info(`[PluginManager] Registered command: ${config.label}`);
      },
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pluginModule = require(entryPath);
      if (typeof pluginModule.activate === 'function') {
        pluginModule.activate(ctx);
      }
    } catch (err) {
      log.error(`[PluginManager] Failed to load plugin ${manifest.name}:`, err);
      throw new Error(`Failed to load plugin: ${String(err)}`);
    }

    this.plugins.set(manifest.name, plugin);
    log.info(`[PluginManager] Plugin loaded: ${manifest.name}@${manifest.version}`);
    return plugin;
  }

  unload(pluginName: string): void {
    this.plugins.delete(pluginName);
    log.info(`[PluginManager] Plugin unloaded: ${pluginName}`);
  }

  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  getCommands(): CommandConfig[] {
    return Array.from(this.plugins.values()).flatMap((p) => p.commands);
  }

  getPanelTabs(): PanelTabConfig[] {
    return Array.from(this.plugins.values()).flatMap((p) => p.panelTabs);
  }
}

let instance: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager();
  }
  return instance;
}
