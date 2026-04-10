/**
 * M8-03: 단축키 치트시트 모달
 *
 * `?` 키로 열림. 그룹별 단축키 목록을 표시한다.
 */

import { FocusTrap } from '../shared/FocusTrap';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; desc: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '탐색',
    shortcuts: [
      { keys: '⌘K', desc: '명령 팔레트' },
      { keys: '⌘B', desc: '사이드바 토글' },
      { keys: '⌘G', desc: 'Git 패널 열기' },
      { keys: '⌘1~9', desc: '세션 번호로 이동' },
      { keys: '⌘⇧N', desc: '새 창 열기' },
    ],
  },
  {
    title: '세션',
    shortcuts: [
      { keys: '⌘N', desc: '새 세션' },
      { keys: '⌘⇧Enter', desc: '브로드캐스트 모드' },
      { keys: '⌘W', desc: '현재 탭 닫기' },
    ],
  },
  {
    title: 'Git',
    shortcuts: [
      { keys: '⌘⇧C', desc: '커밋' },
      { keys: '⌘⇧P', desc: '푸시' },
    ],
  },
  {
    title: '터미널',
    shortcuts: [
      { keys: '⌘F', desc: '터미널 내 검색' },
      { keys: '⌘\\', desc: '수직 분할' },
      { keys: '⌘⇧\\', desc: '수평 분할' },
      { keys: 'Escape', desc: '검색 닫기' },
    ],
  },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <FocusTrap>
        <div
          className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 id="shortcuts-title" className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              키보드 단축키
            </h2>
            <button
              onClick={onClose}
              className="text-sm transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              aria-label="닫기"
            >
              Esc
            </button>
          </div>

          {/* Content */}
          <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-6">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3
                    className="text-xs font-semibold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {group.title}
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {group.shortcuts.map((shortcut) => (
                      <div key={shortcut.keys} className="flex items-center justify-between">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {shortcut.desc}
                        </span>
                        <span
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ml-3"
                          style={{
                            backgroundColor: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {shortcut.keys}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 text-center border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span
                className="font-mono px-1 py-0.5 rounded mr-1"
                style={{ backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border)' }}
              >
                ?
              </span>
              키를 눌러 이 모달을 토글할 수 있습니다
            </span>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
