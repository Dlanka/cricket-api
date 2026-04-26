import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const pointsSchema = new Schema(
  {
    win: { type: Number, min: 0, default: 2 },
    tie: { type: Number, min: 0, default: 1 },
    noResult: { type: Number, min: 0, default: 1 },
    loss: { type: Number, min: 0, default: 0 }
  },
  { _id: false }
);

const organizationSchema = new Schema(
  {
    tenantName: { type: String, trim: true, required: true, default: 'Organization' },
    timezone: { type: String, required: true, default: 'UTC' },
    locale: { type: String, required: true, default: 'en-US' },
    dateFormat: { type: String, required: true, default: 'YYYY-MM-DD' },
    logoUrl: { type: String }
  },
  { _id: false }
);

const tournamentDefaultsSchema = new Schema(
  {
    defaultType: {
      type: String,
      enum: ['LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT', 'SERIES'],
      default: 'LEAGUE',
      required: true
    },
    defaultOversPerInnings: { type: Number, min: 1, default: 20, required: true },
    defaultBallsPerOver: { type: Number, min: 1, default: 6, required: true },
    defaultQualificationCount: { type: Number, min: 2, default: 4, required: true },
    points: { type: pointsSchema, default: () => ({}) }
  },
  { _id: false }
);

const matchRulesSchema = new Schema(
  {
    allowUndo: { type: Boolean, default: true, required: true },
    maxUndoWindowSec: { type: Number, min: 0, default: 0, required: true },
    lockRosterAfterStart: { type: Boolean, default: true, required: true },
    lockMatchConfigAfterStart: { type: Boolean, default: true, required: true },
    requireBothRostersBeforeStart: { type: Boolean, default: true, required: true }
  },
  { _id: false }
);

const permissionsSchema = new Schema(
  {
    ADMIN: { type: [String], default: ['*'] },
    SCORER: {
      type: [String],
      default: ['roster.manage', 'match.start', 'score.write', 'bowler.change']
    },
    VIEWER: { type: [String], default: [] }
  },
  { _id: false }
);

const appSettingsSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    organization: { type: organizationSchema, default: () => ({}) },
    tournamentDefaults: { type: tournamentDefaultsSchema, default: () => ({}) },
    matchRules: { type: matchRulesSchema, default: () => ({}) },
    permissions: { type: permissionsSchema, default: () => ({}) }
  },
  { timestamps: true }
);

appSettingsSchema.index({ tenantId: 1 }, { unique: true });

export type AppSettings = InferSchemaType<typeof appSettingsSchema>;

export const AppSettingsModel = (models.AppSettings as Model<AppSettings>) ||
  model<AppSettings>('AppSettings', appSettingsSchema);
