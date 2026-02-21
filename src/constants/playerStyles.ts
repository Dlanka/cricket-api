export const BATTING_STYLES = ['RIGHT_HAND_BAT', 'LEFT_HAND_BAT'] as const;

export const BOWLING_STYLES = [
  'RIGHT_ARM_FAST',
  'RIGHT_ARM_FAST_MEDIUM',
  'RIGHT_ARM_MEDIUM',
  'RIGHT_ARM_OFF_BREAK',
  'RIGHT_ARM_LEG_BREAK',
  'LEFT_ARM_FAST',
  'LEFT_ARM_FAST_MEDIUM',
  'LEFT_ARM_MEDIUM',
  'LEFT_ARM_ORTHODOX',
  'LEFT_ARM_WRIST_SPIN'
] as const;

export type BattingStyle = (typeof BATTING_STYLES)[number];
export type BowlingStyle = (typeof BOWLING_STYLES)[number];
