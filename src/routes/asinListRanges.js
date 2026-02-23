import express from 'express';
import AsinListRange from '../models/AsinListRange.js';
import AsinListProduct from '../models/AsinListProduct.js';
import AsinDirectory from '../models/AsinDirectory.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get all ranges under a category
router.get('/', requireAuth, async (req, res) => {
  try {
    const { categoryId } = req.query;
    if (!categoryId) {
      return res.status(400).json({ error: 'categoryId query param is required' });
    }

    const ranges = await AsinListRange.find({ categoryId }).sort({ name: 1 }).lean();
    res.json(ranges);
  } catch (error) {
    console.error('Error fetching asin list ranges:', error);
    res.status(500).json({ error: 'Failed to fetch ranges' });
  }
});

// Create a new range under a category
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, categoryId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Range name is required' });
    }
    if (!categoryId) {
      return res.status(400).json({ error: 'categoryId is required' });
    }

    const range = await AsinListRange.create({ name: name.trim(), categoryId });
    res.status(201).json(range);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Range already exists in this category' });
    }
    console.error('Error creating asin list range:', error);
    res.status(500).json({ error: 'Failed to create range' });
  }
});

// Delete a range and cascade-delete its products and orphan assigned ASINs
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const products = await AsinListProduct.find({ rangeId: id }, '_id').lean();
    const productIds = products.map(p => p._id);

    if (productIds.length > 0) {
      await AsinDirectory.updateMany(
        { listProductId: { $in: productIds } },
        { $unset: { listProductId: '' } }
      );
      await AsinListProduct.deleteMany({ _id: { $in: productIds } });
    }

    await AsinListRange.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting asin list range:', error);
    res.status(500).json({ error: 'Failed to delete range' });
  }
});

export default router;
