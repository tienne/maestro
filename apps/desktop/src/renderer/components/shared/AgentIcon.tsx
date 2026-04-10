import type { Agent } from '@maestro/shared-types';

type AgentKind = 'claude' | 'gemini' | 'codex' | 'cursor' | 'opencode' | 'aider' | 'unknown';

function detectKind(agent: Agent): AgentKind {
  const key = `${agent.command} ${agent.name}`.toLowerCase();
  if (key.includes('claude')) return 'claude';
  if (key.includes('gemini')) return 'gemini';
  if (key.includes('codex')) return 'codex';
  if (key.includes('cursor')) return 'cursor';
  if (key.includes('opencode')) return 'opencode';
  if (key.includes('aider')) return 'aider';
  return 'unknown';
}

const AGENT_META: Record<AgentKind, { bg: string; fg: string; label: string }> = {
  claude:    { bg: '#D97706', fg: '#FFF7ED', label: 'C' },
  gemini:    { bg: '#1A73E8', fg: '#FFFFFF', label: 'G' },
  codex:     { bg: '#10B981', fg: '#FFFFFF', label: 'O' },
  cursor:    { bg: '#7C3AED', fg: '#FFFFFF', label: '⌥' },
  opencode:  { bg: '#0EA5E9', fg: '#FFFFFF', label: 'oc' },
  aider:     { bg: '#EC4899', fg: '#FFFFFF', label: 'A' },
  unknown:   { bg: '#4B5563', fg: '#D1D5DB', label: '>' },
};

const SIZE_MAP = {
  sm:  { box: 20, font: 9,  radius: 5 },
  md:  { box: 32, font: 13, radius: 8 },
  lg:  { box: 44, font: 18, radius: 11 },
};

interface Props {
  agent: Agent;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AgentIcon({ agent, size = 'md', className }: Props) {
  const kind = detectKind(agent);
  const meta = AGENT_META[kind];
  const dim = SIZE_MAP[size];

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim.box,
        height: dim.box,
        borderRadius: dim.radius,
        backgroundColor: meta.bg,
        color: meta.fg,
        fontSize: dim.font,
        fontWeight: 700,
        fontFamily: 'system-ui, sans-serif',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {meta.label}
    </span>
  );
}

/** 에이전트 종류 이름 반환 (배지 등에 활용) */
export function getAgentKindLabel(agent: Agent): string {
  return detectKind(agent);
}
