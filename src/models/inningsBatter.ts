import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const inningsBatterSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true
    },
    inningsId: {
      type: Schema.Types.ObjectId,
      ref: 'Innings',
      required: true
    },
    batterKey: {
      playerId: {
        type: Schema.Types.ObjectId,
        ref: 'Player'
      },
      name: {
        type: String,
        trim: true
      }
    },
    playerRef: {
      playerId: {
        type: Schema.Types.ObjectId,
        ref: 'Player'
      },
      name: {
        type: String,
        required: true,
        trim: true
      }
    },
    runs: {
      type: Number,
      default: 0
    },
    balls: {
      type: Number,
      default: 0
    },
    fours: {
      type: Number,
      default: 0
    },
    sixes: {
      type: Number,
      default: 0
    },
    isOut: {
      type: Boolean,
      default: false
    },
    outKind: {
      type: String
    },
    outFielderId: {
      type: Schema.Types.ObjectId,
      ref: 'Player'
    },
    outFielderName: {
      type: String,
      trim: true
    },
    outBowlerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player'
    },
    outBowlerName: {
      type: String,
      trim: true
    },
    position: {
      type: Number
    }
  },
  {
    collection: 'innings_batters',
    timestamps: true
  }
);

inningsBatterSchema.index({ tenantId: 1, inningsId: 1 });
inningsBatterSchema.index({ tenantId: 1, inningsId: 1, 'playerRef.playerId': 1 });
inningsBatterSchema.index(
  { tenantId: 1, inningsId: 1, 'batterKey.playerId': 1 },
  { unique: true, partialFilterExpression: { 'batterKey.playerId': { $exists: true } } }
);

export type InningsBatter = InferSchemaType<typeof inningsBatterSchema>;

export const InningsBatterModel = (models.InningsBatter as Model<InningsBatter>) ||
  model<InningsBatter>('InningsBatter', inningsBatterSchema);
