import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const teamSchema = new Schema(
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
    name: {
      type: String,
      required: true,
      trim: true
    },
    shortName: {
      type: String,
      trim: true
    },
    contactPerson: {
      type: String,
      trim: true
    },
    contactNumber: {
      type: String,
      trim: true
    },
    sourceType: {
      type: String,
      enum: ['TOURNAMENT_TEAM'],
      default: 'TOURNAMENT_TEAM',
      required: true
    }
  },
  {
    timestamps: true
  }
);

teamSchema.index({ tenantId: 1, tournamentId: 1 });
teamSchema.index({ tenantId: 1, tournamentId: 1, name: 1 }, { unique: true });

export type Team = InferSchemaType<typeof teamSchema>;

export const TeamModel = (models.Team as Model<Team>) || model<Team>('Team', teamSchema);
