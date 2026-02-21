import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const membershipSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    role: {
      type: String,
      enum: ['ADMIN', 'SCORER', 'VIEWER'],
      required: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE',
      required: true
    }
  },
  {
    timestamps: true
  }
);

membershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });
membershipSchema.index({ tenantId: 1 });
membershipSchema.index({ userId: 1 });

export type Membership = InferSchemaType<typeof membershipSchema>;

export const MembershipModel = (models.Membership as Model<Membership>) ||
  model<Membership>('Membership', membershipSchema);
