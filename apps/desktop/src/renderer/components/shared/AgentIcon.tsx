import type { Agent } from '@maestro/shared-types';

type AgentKind = 'claude' | 'gemini' | 'codex' | 'cursor' | 'opencode' | 'aider' | 'unknown';

function detectKind(agent: Agent): AgentKind {
  const key = `${agent.command} ${agent.name}`.toLowerCase();
  if (key.includes('claude')) return 'claude';
  if (key.includes('gemini')) return 'gemini';
  if (key.includes('codex') || key.includes('openai')) return 'codex';
  if (key.includes('cursor')) return 'cursor';
  if (key.includes('opencode')) return 'opencode';
  if (key.includes('aider')) return 'aider';
  return 'unknown';
}

// SVG paths sourced from simple-icons (viewBox 0 0 24 24)
const AGENT_META: Record<AgentKind, {
  bg: string;
  fg: string;
  svg?: string;   // simple-icons SVG path
  label?: string; // fallback letter when no svg
}> = {
  claude: {
    bg: '#CC785C',
    fg: '#FFFFFF',
    // Anthropic logo (simple-icons)
    svg: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z',
  },
  gemini: {
    bg: '#8E75B2',
    fg: '#FFFFFF',
    // Google Gemini logo (simple-icons)
    svg: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  },
  codex: {
    // OpenAI not in simple-icons v16 — use styled letter
    bg: '#10B981',
    fg: '#FFFFFF',
    label: 'O',
  },
  cursor: {
    bg: '#1C1C1C',
    fg: '#FFFFFF',
    // Cursor logo (simple-icons)
    svg: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
  },
  opencode: {
    bg: '#0EA5E9',
    fg: '#FFFFFF',
    label: 'oc',
  },
  aider: {
    bg: '#EC4899',
    fg: '#FFFFFF',
    label: 'A',
  },
  unknown: {
    bg: '#4B5563',
    fg: '#D1D5DB',
    label: '>',
  },
};

const SIZE_MAP = {
  sm:  { box: 20, iconSize: 12, font: 9,  radius: 5 },
  md:  { box: 32, iconSize: 20, font: 13, radius: 8 },
  lg:  { box: 44, iconSize: 28, font: 18, radius: 11 },
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
      {meta.svg ? (
        <svg
          viewBox="0 0 24 24"
          width={dim.iconSize}
          height={dim.iconSize}
          fill={meta.fg}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={meta.svg} />
        </svg>
      ) : (
        meta.label
      )}
    </span>
  );
}

/** 에이전트 종류 이름 반환 (배지 등에 활용) */
export function getAgentKindLabel(agent: Agent): string {
  return detectKind(agent);
}
