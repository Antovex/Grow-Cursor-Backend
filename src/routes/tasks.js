import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Task from '../models/Task.js';

const router = Router();

// Create a product research entry (admin or superadmin)
router.post('/', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const body = req.body || {};
  try {
    const task = await Task.create({
      date: body.date ? new Date(body.date) : new Date(),
      productTitle: body.productTitle,
      link: body.link,
      sourcePrice: body.sourcePrice,
      sellingPrice: body.sellingPrice,
      quantity: body.quantity,
      completedQuantity: 0,
      sourcePlatform: body.sourcePlatformId,
      range: body.range,
      category: body.category,
      listingPlatform: body.listingPlatformId,
      store: body.storeId,
      assignedLister: body.assignedListerId || null,
      status: body.assignedListerId ? 'assigned' : 'draft',
      assignedBy: body.assignedListerId ? req.user.userId : null,
      assignedAt: body.assignedListerId ? new Date() : null
    });
    res.json(task);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List tasks (admins see all; listers see assigned to them)
router.get('/', requireAuth, async (req, res) => {
  const { role, userId } = req.user;
  const { platformId, storeId, listerId, date } = req.query || {};
  const query = role === 'lister' ? { assignedLister: userId } : {};
  if (role !== 'lister') {
    if (platformId) query.listingPlatform = platformId;
    if (storeId) query.store = storeId;
    if (listerId) query.assignedLister = listerId;
    if (date) {
      const d = new Date(date);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      query.date = { $gte: start, $lt: end };
    }
  }
  const tasks = await Task.find(query)
    .populate('sourcePlatform')
    .populate('listingPlatform')
    .populate('store')
    .populate('assignedLister', 'email username')
    .sort({ createdAt: -1 });
  res.json(tasks);
});

// Assign a task to a lister (from draft)
router.post('/:id/assign', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { listerId } = req.body || {};
  if (!listerId) return res.status(400).json({ error: 'listerId required' });
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  task.assignedLister = listerId;
  task.status = 'assigned';
  task.assignedBy = req.user.userId;
  task.assignedAt = new Date();
  await task.save();
  res.json(task);
});

// Update task fields (admin/superadmin), only when not completed
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const updates = req.body || {};
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (task.status === 'completed') return res.status(400).json({ error: 'Cannot edit completed task' });
  const editable = ['date','productTitle','link','sourcePrice','sellingPrice','quantity','range','category','sourcePlatform','listingPlatform','store'];
  for (const k of editable) {
    if (updates[k] !== undefined) task[k] = updates[k];
  }
  await task.save();
  res.json(task);
});

// Lister marks completed
router.post('/:id/complete', requireAuth, requireRole('lister'), async (req, res) => {
  const { userId } = req.user;
  const { completedQuantity } = req.body || {};
  const task = await Task.findOne({ _id: req.params.id, assignedLister: userId });
  if (!task) return res.status(404).json({ error: 'Not found' });
  const qty = Math.max(0, Math.min(Number(completedQuantity ?? task.quantity), task.quantity));
  task.completedQuantity = qty;
  if (task.completedQuantity >= task.quantity) {
    task.status = 'completed';
    task.completedAt = new Date();
  } else {
    task.status = 'assigned';
    task.completedAt = undefined;
  }
  await task.save();
  res.json(task);
});

// Admin-side analytics (platform/store/lister/date filters)
router.get('/analytics', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { platformId, storeId, listerId, date } = req.query || {};
  const match = {};
  if (platformId) match.listingPlatform = platformId;
  if (storeId) match.store = storeId;
  if (listerId) match.assignedLister = listerId;
  if (date) {
    const d = new Date(date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    match.date = { $gte: start, $lt: end };
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: null,
        totalListings: { $sum: '$quantity' },
        numListers: { $addToSet: '$assignedLister' },
        numStores: { $addToSet: '$store' },
        ranges: { $addToSet: '$range' },
        categories: { $addToSet: '$category' }
      }
    },
    {
      $project: {
        _id: 0,
        totalListings: 1,
        numListers: { $size: '$numListers' },
        numStores: { $size: '$numStores' },
        numRanges: { $size: '$ranges' },
        numCategories: { $size: '$categories' }
      }
    }
  ];

  const [result] = await Task.aggregate(pipeline);
  res.json(result || { totalListings: 0, numListers: 0, numStores: 0, numRanges: 0, numCategories: 0 });
});

// Superadmin/admin: admin-lister assignment summary
router.get('/analytics/admin-lister', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { platformId, storeId, listerId, date } = req.query || {};
  const match = {};
  if (platformId) match.listingPlatform = platformId;
  if (storeId) match.store = storeId;
  if (listerId) match.assignedLister = listerId;
  if (date) {
    const d = new Date(date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    match.date = { $gte: start, $lt: end };
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { admin: '$assignedBy', lister: '$assignedLister' },
        tasksCount: { $sum: 1 },
        quantityTotal: { $sum: '$quantity' },
        completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        completedQty: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$quantity', 0] } }
      }
    },
    {
      $lookup: { from: 'users', localField: '_id.admin', foreignField: '_id', as: 'admin' }
    },
    { $unwind: { path: '$admin', preserveNullAndEmptyArrays: true } },
    {
      $lookup: { from: 'users', localField: '_id.lister', foreignField: '_id', as: 'lister' }
    },
    { $unwind: { path: '$lister', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        adminId: '$_id.admin',
        listerId: '$_id.lister',
        adminName: '$admin.username',
        listerName: '$lister.username',
        tasksCount: 1,
        quantityTotal: 1,
        completedCount: 1,
        completedQty: 1
      }
    },
    { $sort: { adminName: 1, listerName: 1 } }
  ];

  const rows = await Task.aggregate(pipeline);
  res.json(rows);
});

// Daily totals (optionally filtered by platform/store/lister)
router.get('/analytics/daily', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { platformId, storeId, listerId } = req.query || {};
  const match = {};
  if (platformId) match.listingPlatform = platformId;
  if (storeId) match.store = storeId;
  if (listerId) match.assignedLister = listerId;

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } },
        totalQuantity: { $sum: '$quantity' },
        numListers: { $addToSet: '$assignedLister' },
        numStores: { $addToSet: '$store' },
        ranges: { $addToSet: '$range' },
        categories: { $addToSet: '$category' }
      }
    },
    {
      $project: {
        _id: 0,
        date: '$_id.day',
        totalQuantity: 1,
        numListers: { $size: '$numListers' },
        numStores: { $size: '$numStores' },
        numRanges: { $size: '$ranges' },
        numCategories: { $size: '$categories' }
      }
    },
    { $sort: { date: -1 } }
  ];

  const rows = await Task.aggregate(pipeline);
  res.json(rows);
});

// Per-lister per day with platform/store breakdown
router.get('/analytics/lister-daily', requireAuth, requireRole('superadmin', 'admin'), async (req, res) => {
  const { listerId, platformId, storeId } = req.query || {};
  const match = {};
  if (listerId) match.assignedLister = listerId;
  if (platformId) match.listingPlatform = platformId;
  if (storeId) match.store = storeId;

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: {
          day: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          platform: '$listingPlatform',
          store: '$store'
        },
        tasksCount: { $sum: 1 },
        quantityTotal: { $sum: '$quantity' },
        completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        completedQty: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$quantity', 0] } },
        ranges: { $addToSet: '$range' },
        categories: { $addToSet: '$category' }
      }
    },
    { $lookup: { from: 'platforms', localField: '_id.platform', foreignField: '_id', as: 'platform' } },
    { $unwind: { path: '$platform', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'stores', localField: '_id.store', foreignField: '_id', as: 'store' } },
    { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        date: '$_id.day',
        platform: '$platform.name',
        store: '$store.name',
        tasksCount: 1,
        quantityTotal: 1,
        completedCount: 1,
        completedQty: 1,
        numRanges: { $size: '$ranges' },
        numCategories: { $size: '$categories' }
      }
    },
    { $sort: { date: -1, platform: 1, store: 1 } }
  ];

  const rows = await Task.aggregate(pipeline);
  res.json(rows);
});

export default router;


