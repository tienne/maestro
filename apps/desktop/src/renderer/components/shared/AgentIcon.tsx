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

interface SvgPath {
  d: string;
  fill?: string; // 생략 시 meta.fg 사용
}

interface AgentIconDef {
  bg: string;
  fg: string;
  paths?: SvgPath[]; // 다중 경로 (viewBox 0 0 24 24)
  svg?: string;      // 단일 경로 (paths 없을 때)
  label?: string;    // SVG 없을 때 폴백 레터
}

// SVG paths: simple-icons (viewBox 0 0 24 24) 또는 브랜드 공식 SVG
const AGENT_META: Record<AgentKind, AgentIconDef> = {
  claude: {
    bg: '#CC785C',
    fg: '#FFFFFF',
    // Claude 공식 로고 (simple-icons)
    svg: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  },
  gemini: {
    bg: '#8E75B2',
    fg: '#FFFFFF',
    // Google Gemini 공식 로고 (simple-icons)
    svg: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  },
  codex: {
    bg: '#10B981',
    fg: '#FFFFFF',
    // OpenAI 로고 (simple-icons v16 미지원, 브랜드 SVG 직접 삽입)
    svg: 'M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.6 14.3a4.501 4.501 0 0 1-2.26-6.403zm16.597 3.855-5.843-3.37 2.019-1.168a.076.076 0 0 1 .072 0l4.218 2.435a4.5 4.5 0 0 1-.677 8.125v-5.676a.79.79 0 0 0-.389-.346zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.214-2.43a4.496 4.496 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.496 4.496 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z',
  },
  cursor: {
    bg: '#1C1C1C',
    fg: '#FFFFFF',
    // Cursor 공식 로고 (simple-icons)
    svg: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
  },
  opencode: {
    bg: '#1A1A1A',
    fg: '#FFFFFF',
    // OpenCode 파비콘 SVG (opencode.ai/favicon.svg, viewBox 0 0 512 512 → 24 24 스케일)
    paths: [
      // 외곽 프레임 (흰색)
      { d: 'M18 19.5H6V4.5H18V19.5ZM15 7.5H9V16.5H15V7.5Z', fill: '#FFFFFF' },
      // 내부 사각형 (회색)
      { d: 'M15 10.5V16.5H9V10.5H15Z', fill: '#5A5858' },
    ],
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

  const renderSvg = () => {
    if (meta.paths) {
      return (
        <svg viewBox="0 0 24 24" width={dim.iconSize} height={dim.iconSize} xmlns="http://www.w3.org/2000/svg">
          {meta.paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill ?? meta.fg} />
          ))}
        </svg>
      );
    }
    if (meta.svg) {
      return (
        <svg viewBox="0 0 24 24" width={dim.iconSize} height={dim.iconSize} fill={meta.fg} xmlns="http://www.w3.org/2000/svg">
          <path d={meta.svg} />
        </svg>
      );
    }
    return <>{meta.label}</>;
  };

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
      {renderSvg()}
    </span>
  );
}

/** 에이전트 종류 이름 반환 (배지 등에 활용) */
export function getAgentKindLabel(agent: Agent): string {
  return detectKind(agent);
}
