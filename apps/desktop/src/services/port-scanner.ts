/**
 * Port Scanner — Electron Main Process
 *
 * 세션 PID 기반으로 자식 프로세스가 listen하는 포트를 감지한다.
 * macOS에서 lsof 명령어를 사용해 TCP LISTEN 상태의 포트를 조회한다.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCb);

/**
 * 주어진 PID와 그 자식 프로세스들이 listen하는 TCP 포트 목록을 반환한다.
 *
 * 동작 방식:
 * 1. pgrep -P <pid> 로 자식 PID 목록을 수집
 * 2. 부모 PID + 자식 PID들에 대해 lsof로 LISTEN 상태 포트 조회
 * 3. 중복 제거 후 오름차순 정렬
 *
 * @param pid PTY 프로세스의 PID
 * @returns listen 중인 포트 번호 배열. 실패 시 빈 배열.
 */
export async function getListeningPorts(pid: number): Promise<number[]> {
  try {
    // 1. 자식 프로세스 PID 수집 (재귀적)
    const childPids = await getDescendantPids(pid);
    const allPids = [pid, ...childPids];

    // 2. lsof로 LISTEN 포트 조회
    // -a: AND 조건, -iTCP: TCP만, -sTCP:LISTEN: LISTEN 상태만
    // -P: 포트 번호 그대로 표시, -n: 호스트명 해석 안 함
    const pidArgs = allPids.map((p) => `-p ${p}`).join(' ');
    const { stdout } = await execAsync(
      `lsof -a -iTCP -sTCP:LISTEN -P -n ${pidArgs} 2>/dev/null || true`,
    );

    const ports = new Set<number>();
    const lines = stdout.trim().split('\n');

    // 첫 줄은 헤더 (COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // NAME 컬럼: *:3000 또는 127.0.0.1:3000 또는 [::1]:3000
      const match = line.match(/:(\d+)\s*$/);
      if (match) {
        const port = parseInt(match[1], 10);
        if (port > 0 && port <= 65535) {
          ports.add(port);
        }
      }
    }

    return Array.from(ports).sort((a, b) => a - b);
  } catch {
    // lsof 실패, 권한 부족 등 — 빈 배열 반환
    return [];
  }
}

/**
 * 주어진 PID의 모든 하위(자손) 프로세스 PID를 재귀적으로 수집한다.
 */
async function getDescendantPids(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(`pgrep -P ${pid} 2>/dev/null || true`);
    const directChildren = stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => parseInt(line.trim(), 10))
      .filter((p) => !isNaN(p));

    const descendants: number[] = [...directChildren];
    for (const childPid of directChildren) {
      const grandchildren = await getDescendantPids(childPid);
      descendants.push(...grandchildren);
    }

    return descendants;
  } catch {
    return [];
  }
}
