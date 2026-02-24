import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const matchResultSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['WIN', 'TIE', 'NO_RESULT']
    },
    winnerTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team'
    },
    winByRuns: {
      type: Number
    },
    winByWickets: {
      type: Number
    },
    winByWkts: {
      type: Number
    },
    targetRuns: {
      type: Number
    },
    isNoResult: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: false
  }
);

const tossSchema = new Schema(
  {
    wonByTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    decision: {
      type: String,
      enum: ['BAT', 'BOWL'],
      required: true
    }
  },
  {
    _id: false
  }
);

const matchSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: 'Tournament',
      required: true
    },
    teamAId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    teamBId: {
      type: Schema.Types.ObjectId,
      ref: 'Team'
    },
    stage: {
      type: String,
      enum: ['LEAGUE', 'R1', 'QF', 'SF', 'FINAL'],
      required: true
    },
    roundNumber: {
      type: Number
    },
    scheduledAt: {
      type: Date
    },
    oversPerInnings: {
      type: Number,
      min: 1
    },
    ballsPerOver: {
      type: Number,
      min: 1
    },
    status: {
      type: String,
      enum: ['SCHEDULED', 'LIVE', 'COMPLETED'],
      default: 'SCHEDULED',
      required: true
    },
    currentInningsId: {
      type: Schema.Types.ObjectId,
      ref: 'Innings'
    },
    firstInningsRuns: {
      type: Number
    },
    secondInningsTarget: {
      type: Number
    },
    result: {
      type: matchResultSchema
    },
    phase: {
      type: String,
      enum: ['REGULAR', 'SUPER_OVER'],
      default: 'REGULAR'
    },
    hasSuperOver: {
      type: Boolean,
      default: false
    },
    superOverStatus: {
      type: String,
      enum: ['PENDING', 'LIVE', 'COMPLETED']
    },
    superOverWinnerTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team'
    },
    superOverTie: {
      type: Boolean,
      default: false
    },
    superOverSetup: {
      type: Schema.Types.Mixed
    },
    toss: {
      type: tossSchema
    }
  },
  {
    timestamps: true
  }
);

matchSchema.index({ tenantId: 1, tournamentId: 1 });
matchSchema.index({ tenantId: 1, teamAId: 1 });
matchSchema.index({ tenantId: 1, teamBId: 1 });

export type Match = InferSchemaType<typeof matchSchema>;

export const MatchModel = (models.Match as Model<Match>) || model<Match>('Match', matchSchema);
