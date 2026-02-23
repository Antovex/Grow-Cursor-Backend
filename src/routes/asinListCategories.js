import express from 'express';
import AsinListCategory from '../models/AsinListCategory.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get all categories
router.get('/', requireAuth, async (req, res) => {
  try {
    const categories = await AsinListCategory.find().sort({ name: 1 }).lean();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching asin list categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create a new category
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const category = await AsinListCategory.create({ name: name.trim() });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    console.error('Error creating asin list category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

export default router;
