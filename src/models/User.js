import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: false, unique: true, sparse: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: { 
      type: String, 
      enum: [
        'superadmin', 
        'productadmin', 
        'listingadmin', 
        'lister', 
        'advancelister', 
        'compatibilityadmin', 
        'compatibilityeditor', 
        'seller', 
        'fulfillmentadmin', 
        'hradmin', 
        'hr', 
        'operationhead', 
        'trainee',
        'hoc', 
        'compliancemanager'
      ], 
      required: true 
    },
    department: { type: String, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model('User', UserSchema);