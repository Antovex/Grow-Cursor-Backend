import mongoose from 'mongoose';

const RangeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory', required: true }
  },
  { timestamps: true }
);

RangeSchema.index({ name: 1, subcategory: 1 }, { unique: true });

export default mongoose.model('Range', RangeSchema);
