/**
 * Web Audio API 기반 알림음 유틸리티.
 * 외부 파일 없이 합성음으로 알림음을 재생한다.
 */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * 짧은 벨소리 — 세션 완료 시
 */
export function playSuccessSound(): void {
  const ctx = getAudioCtx();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);       // A5
  oscillator.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1); // E6

  gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.4);
}

/**
 * 낮고 짧은 경고음 — 세션 에러 시
 */
export function playErrorSound(): void {
  const ctx = getAudioCtx();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(220, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.3);

  gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.4);
}
