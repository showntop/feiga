import test from "node:test";
import assert from "node:assert/strict";

import {
  LEVEL_5,
  idleAgent,
  makeRandomAgent,
  simulateBatch,
  smartAgent,
} from "./sim.ts";

test("level 5 reasonable strategy is viable while idle and random play are not", () => {
  const games = 200;

  const smart = simulateBatch(LEVEL_5, smartAgent, games);
  const random = simulateBatch(LEVEL_5, makeRandomAgent(42), games);
  const idle = simulateBatch(LEVEL_5, idleAgent, games);

  assert.ok(
    smart.winRate >= 0.6 && smart.winRate <= 0.8,
    `expected smart win rate between 60%-80%, got ${smart.winRate}`
  );
  assert.ok(
    random.winRate < 0.35,
    `expected random win rate below 35%, got ${random.winRate}`
  );
  assert.equal(idle.winRate, 0, "idle play should never win");
  assert.ok(
    idle.avgFinalRep >= LEVEL_5.reputationEconomy.noInterferenceFloor,
    `idle AI reputation should reach noInterferenceFloor, got ${idle.avgFinalRep}`
  );
  assert.ok(
    smart.avgAccidentWindows >= 2,
    `expected at least 2 accident windows, got ${smart.avgAccidentWindows}`
  );
});
