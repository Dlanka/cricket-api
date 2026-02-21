import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';
import { BATTING_STYLES, BOWLING_STYLES } from '../constants/playerStyles';

const playerSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    jerseyNumber: {
      type: Number
    },
    battingStyle: {
      type: String,
      enum: BATTING_STYLES,
      trim: true
    },
    bowlingStyle: {
      type: String,
      enum: BOWLING_STYLES,
      trim: true
    },
    isWicketKeeper: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

playerSchema.index({ tenantId: 1, teamId: 1 });

export type Player = InferSchemaType<typeof playerSchema>;

export const PlayerModel = (models.Player as Model<Player>) ||
  model<Player>('Player', playerSchema);

