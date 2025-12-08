import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';

const router = Router();

// Get daily order statistics for all sellers
router.get('/daily-statistics', requireAuth, requireRole('fulfillmentadmin', 'superadmin', 'hoc', 'compliancemanager'), async (req, res) => {
  try {
    const { startDate, endDate, sellerId } = req.query;

    // Build the query - NO CANCELSTATE FILTER (matches FulfillmentDashboard)
    const query = {};

    // Add date filter if provided
    // Use the SAME timezone logic as FulfillmentDashboard (PST - UTC-8)
    if (startDate || endDate) {
      query.dateSold = {}; // Use dateSold field, not creationDate
      const PST_OFFSET_HOURS = 8;

      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(PST_OFFSET_HOURS, 0, 0, 0);
        query.dateSold.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        end.setUTCHours(PST_OFFSET_HOURS - 1, 59, 59, 999);
        query.dateSold.$lte = end;
      }
    }

    // Add seller filter if provided
    if (sellerId) {
      query.seller = sellerId;
    }

    // Aggregate orders by seller, date, and marketplace
    const statistics = await Order.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'sellers',
          localField: 'seller',
          foreignField: '_id',
          as: 'sellerInfo'
        }
      },
      { $unwind: '$sellerInfo' },
      {
        $lookup: {
          from: 'users',
          localField: 'sellerInfo.user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          seller: '$seller',
          sellerUsername: '$userInfo.username',
          orderDate: {
            // Convert UTC date to PST date string (matching FulfillmentDashboard)
            $dateToString: { 
              format: '%Y-%m-%d', 
              date: '$dateSold', // Use dateSold field
              timezone: 'America/Los_Angeles' // PST/PDT timezone
            }
          },
          marketplace: { $ifNull: ['$purchaseMarketplaceId', 'Unknown'] }
        }
      },
      {
        $group: {
          _id: {
            seller: '$seller',
            sellerUsername: '$sellerUsername',
            date: '$orderDate',
            marketplace: '$marketplace'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: {
            seller: '$_id.seller',
            sellerUsername: '$_id.sellerUsername',
            date: '$_id.date'
          },
          totalOrders: { $sum: '$count' },
          marketplaceBreakdown: {
            $push: {
              marketplace: '$_id.marketplace',
              count: '$count'
            }
          }
        }
      },
      {
        $sort: { '_id.date': -1, '_id.sellerUsername': 1 }
      }
    ]);

    // Transform the data for easier consumption on the frontend
    const formattedStatistics = statistics.map(stat => ({
      seller: {
        id: stat._id.seller,
        username: stat._id.sellerUsername
      },
      date: stat._id.date,
      totalOrders: stat.totalOrders,
      marketplaceBreakdown: stat.marketplaceBreakdown
    }));

    res.json(formattedStatistics);
  } catch (error) {
    console.error('Error fetching daily order statistics:', error);
    res.status(500).json({ error: 'Failed to fetch order statistics' });
  }
});

export default router;
