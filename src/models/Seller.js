import mongoose from 'mongoose';


const SellerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    ebayMarketplaces: [{ type: String, required: true }], // e.g., ['EBAY_US', 'EBAY_UK']
    ebayTokens: {
      access_token: String,
      refresh_token: String,
      expires_in: Number,
      refresh_token_expires_in: Number,
      token_type: String,
      scope: String,
      fetchedAt: Date
    },
    // Polling metadata for efficient order syncing
    lastPolledAt: { type: Date, default: null }, // Last time we successfully polled for updates
    initialSyncDate: { type: Date, default: () => new Date(Date.UTC(2025, 9, 17, 0, 0, 0, 0)) } // Oct 17, 2025 00:00:00 UTC
  },
  { timestamps: true }
);

export default mongoose.model('Seller', SellerSchema);
