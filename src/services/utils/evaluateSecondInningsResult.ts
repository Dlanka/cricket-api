type TeamRefLike = { toString(): string } | string;

type MatchLike = {
  secondInningsTarget?: number | null;
};

type InningsLike = {
  runs: number;
  wickets: number;
  balls: number;
  battingTeamId: TeamRefLike;
};

type EvaluateInput = {
  match: MatchLike;
  innings1: InningsLike;
  innings2: InningsLike;
  maxLegalBalls: number;
};

type EvaluateOutput = {
  isMatchCompleted: boolean;
  result?: {
    type: 'WIN' | 'TIE';
    winnerTeamId: string | null;
    winByRuns: number | null;
    winByWickets: number | null;
    targetRuns: number;
  };
};

const asId = (value: TeamRefLike) =>
  typeof value === 'string' ? value : value.toString();

export const evaluateSecondInningsResult = ({
  match,
  innings1,
  innings2,
  maxLegalBalls
}: EvaluateInput): EvaluateOutput => {
  const targetRuns = match.secondInningsTarget ?? innings1.runs + 1;

  if (innings2.runs >= targetRuns) {
    return {
      isMatchCompleted: true,
      result: {
        type: 'WIN',
        winnerTeamId: asId(innings2.battingTeamId),
        winByRuns: null,
        winByWickets: Math.max(0, 10 - innings2.wickets),
        targetRuns
      }
    };
  }

  const inningsEnded = innings2.wickets >= 10 || innings2.balls >= maxLegalBalls;
  if (!inningsEnded) {
    return { isMatchCompleted: false };
  }

  if (innings2.runs === innings1.runs) {
    return {
      isMatchCompleted: true,
      result: {
        type: 'TIE',
        winnerTeamId: null,
        winByRuns: null,
        winByWickets: null,
        targetRuns
      }
    };
  }

  return {
    isMatchCompleted: true,
    result: {
      type: 'WIN',
      winnerTeamId: asId(innings1.battingTeamId),
      winByRuns: innings1.runs - innings2.runs,
      winByWickets: null,
      targetRuns
    }
  };
};

