import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'BLOCKED'],
      default: 'ACTIVE',
      required: true
    }
  },
  {
    timestamps: true
  }
);

export type User = InferSchemaType<typeof userSchema>;

export const UserModel = (models.User as Model<User>) || model<User>('User', userSchema);
