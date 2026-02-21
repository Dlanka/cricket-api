import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const notificationsSchema = new Schema(
  {
    email: { type: Boolean, required: true, default: true },
    inApp: { type: Boolean, required: true, default: true }
  },
  { _id: false }
);

const preferencesSchema = new Schema(
  {
    locale: { type: String, required: true, default: 'en-US' },
    timezone: { type: String, required: true, default: 'UTC' },
    dateFormat: { type: String, required: true, default: 'YYYY-MM-DD' },
    theme: { type: String, enum: ['light', 'dark', 'system'], required: true, default: 'system' },
    notifications: { type: notificationsSchema, default: () => ({}) }
  },
  { _id: false }
);

const userSettingsSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    preferences: { type: preferencesSchema, default: () => ({}) }
  },
  { timestamps: true }
);

userSettingsSchema.index({ userId: 1 }, { unique: true });

export type UserSettings = InferSchemaType<typeof userSettingsSchema>;

export const UserSettingsModel = (models.UserSettings as Model<UserSettings>) ||
  model<UserSettings>('UserSettings', userSettingsSchema);
