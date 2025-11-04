import mongoose from 'mongoose';

const RangeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

export default mongoose.model('Range', RangeSchema);
