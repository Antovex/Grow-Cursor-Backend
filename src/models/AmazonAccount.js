// models/AmazonAccount.js
import mongoose from 'mongoose';

const AmazonAccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

export default mongoose.model('AmazonAccount', AmazonAccountSchema);