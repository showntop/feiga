/**
 * 《别让 AI 转正》数值模拟器 v5
 *
 * 玩法核：单条 AI 认可度 + 锅（分大小）+ 资源稀缺 + 信息不全。
 * - 认可度 30→100，AI 匀速涨；到 100 玩家输，撑到 90s 且 <100 玩家赢。
 * - 加/改需求：压制涨幅（持续火力）。
 * - 锅：随机大小（小/中/大）掉落，window 秒窗口。不甩 → AI 反咬（按大小涨）；甩 → AI 大降。
 * - 甩锅次数稀缺（默认 3 次/局），玩家必须挑（救大放小、赌后面）。
 * - 无怀疑度；无 AI 反甩（反甩留作后期 Boss 关变体）。
 *
 * 运行：npx tsx scripts/sim/sim.ts
 */

type ActionType = 'addWork' | 'changeReq' | 'blame';
type PotSize = 'small' | 'medium' | 'large';

interface BlameEvent {
  id: number;
  spawnTick: number;
  expireTick: number;
  size: PotSize;
  resolved: null | 'player' | 'ai';
}

interface SuppressAction {
  count: number;
  suppressSec: number;
  directDelta: number;
}

interface LevelConfig {
  levelId: number;
  initialApproval: number;
  loseAt: number;
  duration: number;
  aiBaseRate: number;
  actions: {
    addWork: SuppressAction;
    changeReq: SuppressAction;
    blame: { count: number; playerHitDelta: number };
  };
  blameEvent: {
    minInterval: number;
    maxInterval: number;
    windowSec: number;
    firstDelay: number;
    sizes: Record<PotSize, { prob: number; bite: number }>;
  };
}

const TICK = 0.5;

export const LEVEL_5: LevelConfig = {
  levelId: 5,
  initialApproval: 30,
  loseAt: 100,
  duration: 90,
  aiBaseRate: 1.0,
  actions: {
    addWork: { count: 4, suppressSec: 3, directDelta: -2 },
    changeReq: { count: 3, suppressSec: 2, directDelta: -5 },
    blame: { count: 2, playerHitDelta: -18 },
  },
  blameEvent: {
    minInterval: 10,
    maxInterval: 14,
    windowSec: 5,
    firstDelay: 6,
    sizes: {
      small: { prob: 0.45, bite: 5 },
      medium: { prob: 0.35, bite: 10 },
      large: { prob: 0.2, bite: 28 },
    },
  },
};

interface EngineState {
  tick: number;
  timeLeft: number;
  approval: number;
  suppressUntilTick: number;
  events: BlameEvent[];
  nextEventTick: number;
  eventIdSeq: number;
  usage: Record<ActionType, number>;
  stats: {
    blameHits: number;
    blameMisses: number;
    aiBites: number;
    eventsTotal: number;
  };
  rng: () => number;
}

function makeRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function rollSize(cfg: LevelConfig, rng: () => number): PotSize {
  const r = rng();
  const { small, medium } = cfg.blameEvent.sizes;
  if (r < small.prob) return 'small';
  if (r < small.prob + medium.prob) return 'medium';
  return 'large';
}

function createState(cfg: LevelConfig, rng: () => number): EngineState {
  return {
    tick: 0,
    timeLeft: cfg.duration,
    approval: cfg.initialApproval,
    suppressUntilTick: 0,
    events: [],
    nextEventTick: Math.round(cfg.blameEvent.firstDelay / TICK),
    eventIdSeq: 0,
    usage: { addWork: 0, changeReq: 0, blame: 0 },
    stats: { blameHits: 0, blameMisses: 0, aiBites: 0, eventsTotal: 0 },
    rng,
  };
}

function pendingEvent(s: EngineState): BlameEvent | undefined {
  return s.events.find((e) => e.resolved === null && s.tick < e.expireTick);
}

function step(s: EngineState, cfg: LevelConfig) {
  s.tick += 1;
  s.timeLeft -= TICK;

  if (s.tick > s.suppressUntilTick) {
    s.approval = clamp(s.approval + cfg.aiBaseRate * TICK, 0, cfg.loseAt);
  }

  if (s.tick >= s.nextEventTick) {
    s.events.push({
      id: s.eventIdSeq++,
      spawnTick: s.tick,
      expireTick: s.tick + Math.round(cfg.blameEvent.windowSec / TICK),
      size: rollSize(cfg, s.rng),
      resolved: null,
    });
    s.stats.eventsTotal += 1;
    const gap = cfg.blameEvent.minInterval + s.rng() * (cfg.blameEvent.maxInterval - cfg.blameEvent.minInterval);
    s.nextEventTick = s.tick + Math.round(gap / TICK);
  }

  for (const e of s.events) {
    if (e.resolved === null && s.tick >= e.expireTick) {
      e.resolved = 'ai';
      s.approval = clamp(s.approval + cfg.blameEvent.sizes[e.size].bite, 0, cfg.loseAt);
      s.stats.aiBites += 1;
    }
  }
}

function doAddWork(s: EngineState, cfg: LevelConfig) {
  s.usage.addWork += 1;
  s.suppressUntilTick = Math.max(s.suppressUntilTick, s.tick + Math.round(cfg.actions.addWork.suppressSec / TICK));
  s.approval = clamp(s.approval + cfg.actions.addWork.directDelta, 0, cfg.loseAt);
}

function doChangeReq(s: EngineState, cfg: LevelConfig) {
  s.usage.changeReq += 1;
  s.suppressUntilTick = Math.max(s.suppressUntilTick, s.tick + Math.round(cfg.actions.changeReq.suppressSec / TICK));
  s.approval = clamp(s.approval + cfg.actions.changeReq.directDelta, 0, cfg.loseAt);
}

function doBlame(s: EngineState, cfg: LevelConfig) {
  s.usage.blame += 1;
  const e = pendingEvent(s);
  if (e) {
    e.resolved = 'player';
    s.approval = clamp(s.approval + cfg.actions.blame.playerHitDelta, 0, cfg.loseAt);
    s.stats.blameHits += 1;
  } else {
    s.stats.blameMisses += 1;
  }
}

// ============================================================
// Agent
// ============================================================

export interface Agent {
  name: string;
  act: (s: EngineState, cfg: LevelConfig, usesLeft: Record<ActionType, number>) => void;
}

/** smart：救大放小、留次数赌后面；平时压制涨幅。取舍型基准。 */
export const smartAgent: Agent = {
  name: 'smart',
  act(s, cfg, usesLeft) {
    const e = pendingEvent(s);
    if (e && usesLeft.blame > 0) {
      if (e.size === 'large') { doBlame(s, cfg); return; }
      if (e.size === 'medium' && usesLeft.blame >= 2) { doBlame(s, cfg); return; }
      if (e.size === 'small' && s.approval >= 85 && usesLeft.blame >= 2) { doBlame(s, cfg); return; }
    }
    if (s.tick > s.suppressUntilTick && s.approval >= 55) {
      if (usesLeft.changeReq > 0) { doChangeReq(s, cfg); return; }
      if (usesLeft.addWork > 0) { doAddWork(s, cfg); return; }
    }
  },
};

/** medium：会抢锅但不挑大小（次数容易浪费在小锅上）。验证「挑不挑」是否拉开差距。 */
export const mediumAgent: Agent = {
  name: 'medium',
  act(s, cfg, usesLeft) {
    if (pendingEvent(s) && usesLeft.blame > 0) { doBlame(s, cfg); return; }
    if (s.tick > s.suppressUntilTick && s.approval >= 55) {
      if (usesLeft.changeReq > 0) { doChangeReq(s, cfg); return; }
      if (usesLeft.addWork > 0) { doAddWork(s, cfg); return; }
    }
  },
};

export function makeRandomAgent(): Agent {
  return {
    name: 'random',
    act(s, cfg, usesLeft) {
      const opts: ActionType[] = [];
      if (usesLeft.addWork > 0) opts.push('addWork');
      if (usesLeft.changeReq > 0) opts.push('changeReq');
      if (usesLeft.blame > 0) opts.push('blame');
      if (opts.length === 0) return;
      const a = opts[Math.floor(s.rng() * opts.length)];
      if (a === 'addWork') doAddWork(s, cfg);
      else if (a === 'changeReq') doChangeReq(s, cfg);
      else doBlame(s, cfg);
    },
  };
}

export function makeSingleActionAgent(only: ActionType): Agent {
  return {
    name: `single-${only}`,
    act(s, cfg, usesLeft) {
      if (usesLeft[only] <= 0) return;
      if (only === 'addWork') doAddWork(s, cfg);
      else if (only === 'changeReq') doChangeReq(s, cfg);
      else doBlame(s, cfg);
    },
  };
}

export const idleAgent: Agent = { name: 'idle', act() {} };

// ============================================================
// 跑局 / 统计
// ============================================================

export interface GameResult {
  win: boolean;
  reason: string;
  duration: number;
  finalApproval: number;
  eventsTotal: number;
  blameHits: number;
  blameMisses: number;
  aiBites: number;
  usage: Record<ActionType, number>;
}

export function simulateOne(cfg: LevelConfig, agent: Agent, seed: number): GameResult {
  const s = createState(cfg, makeRng(seed));
  const total: Record<ActionType, number> = {
    addWork: cfg.actions.addWork.count,
    changeReq: cfg.actions.changeReq.count,
    blame: cfg.actions.blame.count,
  };
  let reason = 'settle';
  let win = false;

  while (s.timeLeft > 0) {
    if (s.tick % 2 === 0) {
      const usesLeft: Record<ActionType, number> = {
        addWork: Math.max(0, total.addWork - s.usage.addWork),
        changeReq: Math.max(0, total.changeReq - s.usage.changeReq),
        blame: Math.max(0, total.blame - s.usage.blame),
      };
      agent.act(s, cfg, usesLeft);
    }
    step(s, cfg);
    if (s.approval >= cfg.loseAt) { reason = 'aiPromoted'; break; }
  }

  if (s.timeLeft <= 0) {
    win = s.approval < cfg.loseAt;
    reason = win ? 'settleWin' : 'settleLose';
  }

  return {
    win,
    reason,
    duration: cfg.duration - s.timeLeft,
    finalApproval: s.approval,
    eventsTotal: s.stats.eventsTotal,
    blameHits: s.stats.blameHits,
    blameMisses: s.stats.blameMisses,
    aiBites: s.stats.aiBites,
    usage: { ...s.usage },
  };
}

interface BatchStats {
  label: string;
  games: number;
  winRate: number;
  avgDuration: number;
  avgFinalApproval: number;
  avgEvents: number;
  blameHitRate: number;
  usage: Record<ActionType, number>;
  reasons: Record<string, number>;
}

export function simulateBatch(cfg: LevelConfig, agent: Agent, n: number, baseSeed = 1): BatchStats {
  const results: GameResult[] = [];
  for (let i = 0; i < n; i++) results.push(simulateOne(cfg, agent, baseSeed + i));
  const avg = (f: (r: GameResult) => number) => results.reduce((a, r) => a + f(r), 0) / n;
  const sum = (f: (r: GameResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const reasons: Record<string, number> = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const hits = sum((r) => r.blameHits);
  const bites = sum((r) => r.aiBites);
  return {
    label: agent.name,
    games: n,
    winRate: results.filter((r) => r.win).length / n,
    avgDuration: avg((r) => r.duration),
    avgFinalApproval: avg((r) => r.finalApproval),
    avgEvents: avg((r) => r.eventsTotal),
    blameHitRate: hits + bites > 0 ? hits / (hits + bites) : 0,
    usage: {
      addWork: avg((r) => r.usage.addWork),
      changeReq: avg((r) => r.usage.changeReq),
      blame: avg((r) => r.usage.blame),
    },
    reasons,
  };
}

function printReport(st: BatchStats) {
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  console.log(`\n=== ${st.label} (${st.games} 局) ===`);
  console.log(`  胜率          : ${pct(st.winRate)}`);
  console.log(`  平均局长      : ${st.avgDuration.toFixed(1)}s`);
  console.log(`  认可度终值    : ${st.avgFinalApproval.toFixed(1)} / 100`);
  console.log(`  每局锅事件    : ${st.avgEvents.toFixed(2)}`);
  console.log(`  锅抢中率      : ${pct(st.blameHitRate)}`);
  console.log(`  动作使用(局均): 加 ${st.usage.addWork.toFixed(2)} / 改 ${st.usage.changeReq.toFixed(2)} / 甩 ${st.usage.blame.toFixed(2)}`);
  console.log(`  结束原因      : ${JSON.stringify(st.reasons)}`);
}

function check(label: string, pass: boolean, value: unknown) {
  const v = typeof value === 'number' ? value.toFixed(3) : JSON.stringify(value);
  console.log(`  ${pass ? '✅' : '❌'} ${label}  →  ${v}`);
}

function verdict(stats: Record<string, BatchStats>) {
  const s = stats['smart'];
  const m = stats['medium'];
  const r = stats['random'];
  const idle = stats['idle'];
  console.log('\n========== 校验结论（目标：胜率连续分布）==========');
  check('smart 胜率 ≥ 80%（可解）', s.winRate >= 0.8, s.winRate);
  if (m) {
    check('medium 落在 smart 与 random 之间（取舍有效）', m.winRate < s.winRate && m.winRate > r.winRate, {
      smart: s.winRate,
      medium: m.winRate,
      random: r.winRate,
    });
  }
  check('random 胜率 < 35%', r.winRate < 0.35, r.winRate);
  if (idle) check('完全不干扰必输', idle.winRate === 0, idle.winRate);
}

function main() {
  const N = 1000;
  const cfg = LEVEL_5;
  console.log(`《别让 AI 转正》数值模拟 v5 — 第 ${cfg.levelId} 关 / 每档 ${N} 局`);

  const stats: Record<string, BatchStats> = {};
  stats['smart'] = simulateBatch(cfg, smartAgent, N, 1);
  stats['medium'] = simulateBatch(cfg, mediumAgent, N, 6001);
  stats['random'] = simulateBatch(cfg, makeRandomAgent(), N, 1001);
  stats['single-addWork'] = simulateBatch(cfg, makeSingleActionAgent('addWork'), N, 2001);
  stats['single-changeReq'] = simulateBatch(cfg, makeSingleActionAgent('changeReq'), N, 3001);
  stats['single-blame'] = simulateBatch(cfg, makeSingleActionAgent('blame'), N, 4001);
  stats['idle'] = simulateBatch(cfg, idleAgent, N, 5001);

  for (const k of Object.keys(stats)) printReport(stats[k]);
  verdict(stats);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
