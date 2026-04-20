import { strict as assert } from 'node:assert';
import { applyStrikeRotationForDelivery } from '../services/utils/strikeRotation';

const A = 'A';
const B = 'B';

const replayOver = (runs: number[]) => {
  let striker = A;
  let nonStriker = B;

  runs.forEach((run, index) => {
    const overEnded = index === runs.length - 1;
    const next = applyStrikeRotationForDelivery({
      strikerId: striker,
      nonStrikerId: nonStriker,
      completedRuns: run,
      overEnded,
      inningsCompleted: false
    });
    striker = next.strikerId;
    nonStriker = next.nonStrikerId;
  });

  return { striker, nonStriker };
};

const expectOverResult = (label: string, runs: number[], expectedStriker: string) => {
  const result = replayOver(runs);
  assert.equal(
    result.striker,
    expectedStriker,
    `${label}: expected striker ${expectedStriker}, got ${result.striker}`
  );
  console.log(`PASS ${label}: next over striker ${result.striker}`);
};

const expectSingleDelivery = (
  label: string,
  completedRuns: number,
  overEnded: boolean,
  expectedStriker: string
) => {
  const result = applyStrikeRotationForDelivery({
    strikerId: A,
    nonStrikerId: B,
    completedRuns,
    overEnded,
    inningsCompleted: false
  });
  assert.equal(
    result.strikerId,
    expectedStriker,
    `${label}: expected striker ${expectedStriker}, got ${result.strikerId}`
  );
  console.log(`PASS ${label}: striker ${result.strikerId}`);
};

const run = () => {
  // User-provided end-of-over sequences.
  expectOverResult('0,1,0,2,1,0', [0, 1, 0, 2, 1, 0], B);
  expectOverResult('0,1,0,2,1,1', [0, 1, 0, 2, 1, 1], A);
  expectOverResult('0,1,0,2,1,2', [0, 1, 0, 2, 1, 2], B);
  // Wicket on last ball (0 completed runs) => only over-end rotation.
  expectOverResult('0,1,0,2,1,W(0)', [0, 1, 0, 2, 1, 0], B);

  expectOverResult('1,4,6,0,1,0', [1, 4, 6, 0, 1, 0], B);
  expectOverResult('1,4,6,0,1,1', [1, 4, 6, 0, 1, 1], A);
  expectOverResult('1,4,6,0,1,2', [1, 4, 6, 0, 1, 2], B);

  // Extra delivery rotation basis: completed runs only.
  expectSingleDelivery('Wide + 0 (not over end)', 0, false, A);
  expectSingleDelivery('Wide + 1 (not over end)', 1, false, B);

  console.log('Strike rotation checks passed.');
};

run();

