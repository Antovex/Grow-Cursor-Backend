import express from 'express';
import AsinListRange from '../models/AsinListRange.js';
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

export default router;
