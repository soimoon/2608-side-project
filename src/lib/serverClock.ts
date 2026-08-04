import { supabase } from './supabase';

/**
 * 서버 시계와의 오프셋을 구해 두고, performance.now() 앵커로 벽시계 점프(OS NTP 보정,
 * 사용자의 시계 변경 등)에 흔들리지 않는 serverNow()를 제공한다.
 *
 * 락스텝 라운드 스케줄은 이 값 하나에 통째로 의존한다 — 여기가 어긋나면 게임 전체가
 * 어긋나므로, "serverNow() = Date.now() + offset"처럼 벽시계에 직접 얹지 않는다. 대신
 * 동기화된 순간의 (performance.now(), 서버시각) 쌍을 앵커로 고정해 두고, 이후로는
 * performance.now()의 경과(단조 증가, 벽시계 점프의 영향을 안 받음)만 더한다.
 */

interface Anchor {
  perf: number;
  server: number;
}

let anchor: Anchor | null = null;
let lastRttMs = 0;
let lastOffsetMs = 0;

async function sampleOnce(): Promise<{ offsetMs: number; rttMs: number } | null> {
  if (!supabase) return null;
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('server_now_ms');
    const t1 = Date.now();
    if (error || typeof data !== 'number') return null;
    return { offsetMs: data - (t0 + t1) / 2, rttMs: t1 - t0 };
  } catch {
    return null;
  }
}

/**
 * 서버 시계를 동기화한다. samples회 측정해 왕복시간(rtt)이 가장 작은 샘플을 채택한다 —
 * 네트워크 지연은 대칭이 아니라 비대칭적으로 튀므로, 평균보다 최솟값 샘플이 더 정확하다.
 * 실패하면(오프라인 등) 기존 앵커를 그대로 두고 null을 돌려준다 — 게임 자체를 막지 않는다.
 */
export async function syncServerClock(samples = 3): Promise<{ offsetMs: number; rttMs: number } | null> {
  let best: { offsetMs: number; rttMs: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const s = await sampleOnce();
    if (s && (!best || s.rttMs < best.rttMs)) best = s;
  }
  if (!best) return null;
  anchor = { perf: performance.now(), server: Date.now() + best.offsetMs };
  lastOffsetMs = best.offsetMs;
  lastRttMs = best.rttMs;
  return best;
}

/** 현재 서버 시각 추정치(epoch ms). 동기화 전이면 로컬 시계를 그대로 쓴다. */
export function serverNow(): number {
  if (!anchor) return Date.now();
  return anchor.server + (performance.now() - anchor.perf);
}

export function clockStatus(): { synced: boolean; offsetMs: number; rttMs: number } {
  return { synced: anchor !== null, offsetMs: lastOffsetMs, rttMs: lastRttMs };
}

/**
 * 벽시계 기준 Date.now()와 앵커로 추정한 serverNow()가 250ms 이상 벌어졌는지.
 * 노트북 슬립처럼 performance.now()가 실제로 멈췄다 재개되는 경우를 잡아내는 방어용
 * 신호다 — 이 경우 재동기화가 필요하다.
 */
export function clockDrifted(): boolean {
  if (!anchor) return false;
  return Math.abs(Date.now() - serverNow()) > 250;
}
