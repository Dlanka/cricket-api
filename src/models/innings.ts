import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const inningsSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    matchId: {
      type: Schema.Types.ObjectId,
      ref: 'Match',
      required: true
    },
    inningsNumber: {
      type: Number,
      enum: [1, 2, 3, 4],
      required: true
    },
    battingTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    bowlingTeamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    strikerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true
    },
    nonStrikerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true
    },
    currentBowlerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true
    },
    runs: {
      type: Number,
      default: 0
    },
    wickets: {
      type: Number,
      default: 0
    },
    balls: {
      type: Number,
      default: 0
    },
    ballsPerOver: {
      type: Number,
      default: 6
    },
    oversPerInnings: {
      type: Number
    },
    eventSeq: {
      type: Number,
      default: 0
    },
    lastSeq: {
      type: Number,
      default: 0
    },
    currentOver: {
      type: Schema.Types.Mixed,
      default: {
        overNumber: 0,
        legalBallsInOver: 0,
        balls: []
      }
    },
    status: {
      type: String,
      enum: ['LIVE', 'COMPLETED'],
      default: 'LIVE',
      required: true
    }
  },
  {
    timestamps: true,
    optimisticConcurrency: true
  }
);

inningsSchema.index({ tenantId: 1, matchId: 1, inningsNumber: 1 }, { unique: true });
inningsSchema.index({ tenantId: 1, matchId: 1 });

export type Innings = InferSchemaType<typeof inningsSchema>;

export const InningsModel = (models.Innings as Model<Innings>) ||
  model<Innings>('Innings', inningsSchema);
