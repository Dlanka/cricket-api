import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const scoreEventSchema = new Schema(
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
    inningsId: {
      type: Schema.Types.ObjectId,
      ref: 'Innings',
      required: true
    },
    seq: {
      type: Number,
      required: true
    },
    type: {
      type: String,
      enum: ['run', 'extra', 'wicket', 'swap', 'retire', 'undo'],
      required: true
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true
    },
    isLegal: {
      type: Boolean,
      default: true
    },
    summaryDisplay: {
      type: String,
      default: ''
    },
    beforeSnapshot: {
      type: Schema.Types.Mixed,
      required: true
    },
    afterSnapshot: {
      type: Schema.Types.Mixed,
      required: true
    },
    isUndone: {
      type: Boolean,
      default: false
    },
    undoneAt: {
      type: Date
    },
    undoneByUserId: {
      type: String
    },
    createdByUserId: {
      type: String,
      required: true
    }
  },
  {
    collection: 'score_events',
    timestamps: { createdAt: true, updatedAt: false }
  }
);

scoreEventSchema.index({ tenantId: 1, inningsId: 1, seq: 1 }, { unique: true });
scoreEventSchema.index({ tenantId: 1, inningsId: 1, isUndone: 1, seq: -1 });
scoreEventSchema.index({ tenantId: 1, matchId: 1, inningsId: 1, createdAt: -1 });
scoreEventSchema.index({ tenantId: 1, inningsId: 1, seq: -1 });
scoreEventSchema.index({ tenantId: 1, inningsId: 1, undoneAt: 1 });
scoreEventSchema.index({ tenantId: 1, matchId: 1, inningsId: 1, isUndone: 1, type: 1, seq: -1 });

export type ScoreEvent = InferSchemaType<typeof scoreEventSchema>;

export const ScoreEventModel = (models.ScoreEvent as Model<ScoreEvent>) ||
  model<ScoreEvent>('ScoreEvent', scoreEventSchema);
