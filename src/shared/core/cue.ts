import type { Cue } from '../types'

// seek 落点的浮点误差（如 64582/1000*1000 = 64581.99999999999）会导致
// 严格比较 currentTime >= start 判定失败，字幕“闪一下又消失”。
// 所以：时间取整 + start 端给一个小容差（视频帧时间戳本身也是量化的）。
const CUE_START_EPSILON_MS = 60

export function findActiveCue(cues: Cue[], tMs: number): Cue | null {
  const t = Math.round(tMs)
  for (const c of cues) {
    if (t >= c.start - CUE_START_EPSILON_MS && t < c.end) return c
  }
  return null
}
