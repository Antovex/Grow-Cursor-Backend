import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Range from '../models/Range.js';
import Subcategory from '../models/Subcategory.js';

const router = Router();

router.post('/', requireAuth, requireRole('superadmin', 'productadmin'), async (req, res) => {
  const { name, subcategoryId } = req.body || {};
  if (!name || !subcategoryId) return res.status(400).json({ error: 'name and subcategoryId required' });
  try {
    const range = await Range.create({ name, subcategory: subcategoryId });
    await range.populate('subcategory');
    res.json(range);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  const { subcategoryId, categoryId } = req.query || {};
  
  let query = {};
  
  if (subcategoryId) {
    query.subcategory = subcategoryId;
  } else if (categoryId) {
    // Get all subcategories for this category, then get ranges for those subcategories
    const subcategories = await Subcategory.find({ category: categoryId }).select('_id');
    const subcategoryIds = subcategories.map(s => s._id);
    query.subcategory = { $in: subcategoryIds };
  }
  
  const items = await Range.find(query).populate('subcategory').sort({ name: 1 });
  res.json(items);
});

export default router;
