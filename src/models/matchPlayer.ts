import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const matchPlayerSchema = new Schema(
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
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    playerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true
    },
    isPlaying: {
      type: Boolean,
      default: true
    },
    isCaptain: {
      type: Boolean,
      default: false
    },
    isKeeper: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

matchPlayerSchema.index({ tenantId: 1, matchId: 1, teamId: 1 });
matchPlayerSchema.index({ tenantId: 1, playerId: 1 });

export type MatchPlayer = InferSchemaType<typeof matchPlayerSchema>;

export const MatchPlayerModel = (models.MatchPlayer as Model<MatchPlayer>) ||
  model<MatchPlayer>('MatchPlayer', matchPlayerSchema);
