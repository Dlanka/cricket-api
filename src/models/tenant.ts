import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const tenantSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DISABLED'],
      default: 'ACTIVE',
      required: true
    },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

export type Tenant = InferSchemaType<typeof tenantSchema>;

export const TenantModel = (models.Tenant as Model<Tenant>) ||
  model<Tenant>('Tenant', tenantSchema);
