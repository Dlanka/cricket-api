import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const tournamentTypes = ['LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT', 'SERIES'] as const;
const tournamentStatuses = ['DRAFT', 'ACTIVE', 'COMPLETED'] as const;
const stageStatuses = ['PENDING', 'ACTIVE', 'COMPLETED'] as const;

const pointsRulesSchema = new Schema(
  {
    win: {
      type: Number,
      default: 2,
      min: 0
    },
    tie: {
      type: Number,
      default: 1,
      min: 0
    },
    noResult: {
      type: Number,
      default: 1,
      min: 0
    },
    loss: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    _id: false
  }
);

const tournamentRulesSchema = new Schema(
  {
    points: {
      type: pointsRulesSchema,
      default: () => ({})
    },
    qualificationCount: {
      type: Number,
      default: 4,
      min: 2
    },
    seeding: {
      type: String,
      enum: ['STANDARD'],
      default: 'STANDARD'
    },
    series: {
      totalMatches: {
        type: Number,
        min: 1
      },
      winsToClinch: {
        type: Number,
        min: 1
      }
    }
  },
  {
    _id: false
  }
);

const tournamentStageStatusSchema = new Schema(
  {
    league: {
      type: String,
      enum: stageStatuses,
      default: 'PENDING'
    },
    knockout: {
      type: String,
      enum: stageStatuses,
      default: 'PENDING'
    }
  },
  {
    _id: false
  }
);

const tournamentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    location: {
      type: String,
      trim: true
    },
    startDate: {
      type: Date
    },
    endDate: {
      type: Date
    },
    type: {
      type: String,
      enum: tournamentTypes,
      required: true
    },
    oversPerInnings: {
      type: Number,
      required: true,
      min: 1
    },
    ballsPerOver: {
      type: Number,
      default: 6,
      min: 1
    },
    status: {
      type: String,
      enum: tournamentStatuses,
      default: 'DRAFT'
    },
    rules: {
      type: tournamentRulesSchema,
      default: () => ({})
    },
    stageStatus: {
      type: tournamentStageStatusSchema,
      default: () => ({})
    }
  },
  {
    timestamps: true
  }
);

tournamentSchema.index({ tenantId: 1 });

tournamentSchema.index({ tenantId: 1, name: 1 });

export type Tournament = InferSchemaType<typeof tournamentSchema>;

export const TournamentModel = (models.Tournament as Model<Tournament>) ||
  model<Tournament>('Tournament', tournamentSchema);
