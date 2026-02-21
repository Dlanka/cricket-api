import { Schema, model, type InferSchemaType, type Model, models } from 'mongoose';

const inningsBowlerSchema = new Schema(
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
    playerId: {
      type: Schema.Types.ObjectId,
      ref: 'Player',
      required: true
    },
    name: {
      type: String,
      default: ''
    },
    runsConceded: {
      type: Number,
      default: 0
    },
    balls: {
      type: Number,
      default: 0
    },
    wickets: {
      type: Number,
      default: 0
    },
    maidens: {
      type: Number,
      default: 0
    },
    foursConceded: {
      type: Number,
      default: 0
    },
    sixesConceded: {
      type: Number,
      default: 0
    },
    wides: {
      type: Number,
      default: 0
    },
    noBalls: {
      type: Number,
      default: 0
    }
  },
  {
    collection: 'innings_bowlers',
    timestamps: true
  }
);

inningsBowlerSchema.index({ tenantId: 1, inningsId: 1, playerId: 1 }, { unique: true });

export type InningsBowler = InferSchemaType<typeof inningsBowlerSchema>;

export const InningsBowlerModel = (models.InningsBowler as Model<InningsBowler>) ||
  model<InningsBowler>('InningsBowler', inningsBowlerSchema);
