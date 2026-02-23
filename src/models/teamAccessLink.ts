import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const teamAccessLinkSchema = new Schema(
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
    tokenHash: {
      type: String,
      required: true
    },
    token: {
      type: String
    },
    expiresAt: {
      type: Date,
      required: true
    },
    revokedAt: {
      type: Date
    },
    lastUsedAt: {
      type: Date
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

teamAccessLinkSchema.index({ tokenHash: 1 }, { unique: true });
teamAccessLinkSchema.index({ tenantId: 1, teamId: 1 });
teamAccessLinkSchema.index({ expiresAt: 1 });

export type TeamAccessLink = InferSchemaType<typeof teamAccessLinkSchema>;

export const TeamAccessLinkModel = (models.TeamAccessLink as Model<TeamAccessLink>) ||
  model<TeamAccessLink>('TeamAccessLink', teamAccessLinkSchema);
