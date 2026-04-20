export const shouldRotateOnCompletedRuns = (completedRuns: number) =>
  completedRuns % 2 === 1;

export const swapPair = (strikerId: string, nonStrikerId: string) => ({
  strikerId: nonStrikerId,
  nonStrikerId: strikerId
});

export const applyStrikeRotationForDelivery = (input: {
  strikerId: string;
  nonStrikerId: string;
  completedRuns: number;
  overEnded: boolean;
  inningsCompleted: boolean;
}) => {
  const afterRuns = shouldRotateOnCompletedRuns(input.completedRuns)
    ? swapPair(input.strikerId, input.nonStrikerId)
    : { strikerId: input.strikerId, nonStrikerId: input.nonStrikerId };

  if (input.overEnded) {
    return swapPair(afterRuns.strikerId, afterRuns.nonStrikerId);
  }

  return afterRuns;
};
