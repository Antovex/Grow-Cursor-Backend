import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import TemplateListing from '../models/TemplateListing.js';
import ListingTemplate from '../models/ListingTemplate.js';
import Seller from '../models/Seller.js';
import SellerPricingConfig from '../models/SellerPricingConfig.js';
import { fetchAmazonData, applyFieldConfigs } from '../utils/asinAutofill.js';

const router = express.Router();

// Get all listings for a template
router.get('/', requireAuth, async (req, res) => {
  try {
    const { templateId, sellerId, page = 1, limit = 50 } = req.query;
    
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter with optional seller filtering
    const filter = { templateId };
    if (sellerId) {
      filter.sellerId = sellerId;
    }
    
    const [listings, total] = await Promise.all([
      TemplateListing.find(filter)
        .populate('createdBy', 'name email')
        .populate({
          path: 'sellerId',
          populate: {
            path: 'user',
            select: 'username email'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      TemplateListing.countDocuments(filter)
    ]);
    
    res.json({
      listings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single listing by ID
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const listing = await TemplateListing.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('templateId');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    res.json(listing);
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new listing
router.post('/', requireAuth, async (req, res) => {
  try {
    const listingData = req.body;
    
    if (!listingData.templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    
    if (!listingData.sellerId) {
      return res.status(400).json({ error: 'Seller ID is required' });
    }
    
    // Validate seller exists
    const seller = await Seller.findById(listingData.sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    if (!listingData.customLabel) {
      return res.status(400).json({ error: 'SKU (Custom label) is required' });
    }
    
    if (!listingData.title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!listingData.startPrice && listingData.startPrice !== 0) {
      return res.status(400).json({ error: 'Start price is required' });
    }
    
    // Convert customFields object to Map
    if (listingData.customFields && typeof listingData.customFields === 'object') {
      listingData.customFields = new Map(Object.entries(listingData.customFields));
    }
    
    const listing = new TemplateListing({
      ...listingData,
      createdBy: req.user.userId
    });
    
    await listing.save();
    await listing.populate([
      { path: 'createdBy', select: 'name email' },
      { 
        path: 'sellerId',
        populate: {
          path: 'user',
          select: 'username email'
        }
      }
    ]);
    
    res.status(201).json(listing);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A listing with this SKU already exists in this template' });
    }
    console.error('Error creating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update listing
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const listingData = req.body;
    
    // Convert customFields object to Map
    if (listingData.customFields && typeof listingData.customFields === 'object') {
      listingData.customFields = new Map(Object.entries(listingData.customFields));
    }
    
    listingData.updatedAt = Date.now();
    
    const listing = await TemplateListing.findByIdAndUpdate(
      req.params.id,
      listingData,
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('templateId');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    res.json(listing);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A listing with this SKU already exists in this template' });
    }
    console.error('Error updating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete listing
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const listing = await TemplateListing.findByIdAndDelete(req.params.id);
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    console.error('Error deleting listing:', error);
    res.status(500).json({ error: error.message });
  }
});

// ASIN Autofill endpoint
router.post('/autofill-from-asin', requireAuth, async (req, res) => {
  try {
    const { asin, templateId, sellerId } = req.body;
    
    if (!asin || !templateId) {
      return res.status(400).json({ 
        error: 'ASIN and Template ID are required' 
      });
    }
    
    // 1. Fetch template with automation config
    const template = await ListingTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    if (!template.asinAutomation?.enabled) {
      return res.status(400).json({ 
        error: 'ASIN automation is not enabled for this template' 
      });
    }
    
    // 1.5. Get seller-specific pricing config if sellerId is provided
    let pricingConfig = template.pricingConfig;
    if (sellerId) {
      const sellerConfig = await SellerPricingConfig.findOne({
        sellerId,
        templateId
      });
      if (sellerConfig) {
        pricingConfig = sellerConfig.pricingConfig;
      }
    }
    
    // 2. Fetch fresh Amazon data
    console.log(`Fetching Amazon data for ASIN: ${asin}`);
    const amazonData = await fetchAmazonData(asin);
    
    // 3. Apply field configurations (AI + direct mappings)
    console.log(`Processing ${template.asinAutomation.fieldConfigs.length} field configs`);
    const { coreFields, customFields, pricingCalculation } = await applyFieldConfigs(
      amazonData,
      template.asinAutomation.fieldConfigs,
      pricingConfig  // Use seller-specific or template default pricing config
    );
    
    // 4. Return auto-filled data (separated by type)
    res.json({
      success: true,
      asin,
      autoFilledData: {
        coreFields,
        customFields
      },
      amazonSource: {
        title: amazonData.title,
        brand: amazonData.brand,
        price: amazonData.price,
        imageCount: amazonData.images.length
      },
      pricingCalculation: pricingCalculation || null
    });
    
  } catch (error) {
    console.error('ASIN autofill error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to fetch and process ASIN data' 
    });
  }
});

// Bulk auto-fill from multiple ASINs
router.post('/bulk-autofill-from-asins', requireAuth, async (req, res) => {
  try {
    const { asins, templateId, sellerId } = req.body;
    
    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      return res.status(400).json({ 
        error: 'ASINs array is required and must not be empty' 
      });
    }
    
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    
    if (!sellerId) {
      return res.status(400).json({ error: 'Seller ID is required' });
    }
    
    // Validate batch size
    if (asins.length > 50) {
      return res.status(400).json({ 
        error: 'Maximum 50 ASINs allowed per batch' 
      });
    }
    
    // Fetch template with automation config
    const template = await ListingTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    if (!template.asinAutomation?.enabled) {
      return res.status(400).json({ 
        error: 'ASIN automation is not enabled for this template' 
      });
    }
    
    // Get seller-specific pricing config if available
    let pricingConfig = template.pricingConfig;
    const sellerConfig = await SellerPricingConfig.findOne({
      sellerId,
      templateId
    });
    if (sellerConfig) {
      pricingConfig = sellerConfig.pricingConfig;
    }
    
    // Clean and deduplicate ASINs
    const cleanedAsins = [...new Set(
      asins.map(asin => asin.trim().toUpperCase()).filter(asin => asin.length > 0)
    )];
    
    console.log(`Processing ${cleanedAsins.length} ASINs in batch`);
    
    // Check for existing listings with these ASINs (filter by seller)
    const existingListings = await TemplateListing.find({
      templateId,
      sellerId,
      _asinReference: { $in: cleanedAsins }
    }).select('_asinReference _id');
    
    const existingAsinMap = new Map(
      existingListings.map(listing => [listing._asinReference, listing._id])
    );
    
    const startTime = Date.now();
    const results = [];
    
    // Process ASINs in batches of 5 (parallel within batch, sequential between batches)
    const batchSize = 5;
    for (let i = 0; i < cleanedAsins.length; i += batchSize) {
      const batch = cleanedAsins.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (asin) => {
        // Check if ASIN already exists
        if (existingAsinMap.has(asin)) {
          return {
            asin,
            status: 'duplicate',
            existingListingId: existingAsinMap.get(asin).toString(),
            error: 'ASIN already exists in this template'
          };
        }
        
        try {
          // Fetch Amazon data
          const amazonData = await fetchAmazonData(asin);
          
          // Apply field configurations
          const { coreFields, customFields, pricingCalculation } = await applyFieldConfigs(
            amazonData,
            template.asinAutomation.fieldConfigs,
            pricingConfig  // Use seller-specific or template default pricing config
          );
          
          return {
            asin,
            status: 'success',
            autoFilledData: {
              coreFields,
              customFields
            },
            amazonSource: {
              title: amazonData.title,
              brand: amazonData.brand,
              price: amazonData.price,
              imageCount: amazonData.images.length
            },
            pricingCalculation: pricingCalculation || null
          };
        } catch (error) {
          console.error(`Error processing ASIN ${asin}:`, error);
          return {
            asin,
            status: 'error',
            error: error.message || 'Failed to fetch or process ASIN data'
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add small delay between batches to avoid rate limiting
      if (i + batchSize < cleanedAsins.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const successful = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'error').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    
    console.log(`Bulk autofill completed: ${successful} successful, ${failed} failed, ${duplicates} duplicates in ${processingTime}s`);
    
    res.json({
      success: true,
      total: cleanedAsins.length,
      successful,
      failed,
      duplicates,
      results,
      processingTime: `${processingTime}s`
    });
    
  } catch (error) {
    console.error('Bulk ASIN autofill error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process bulk ASIN autofill' 
    });
  }
});

// Bulk delete listings
router.post('/bulk-delete', requireAuth, async (req, res) => {
  try {
    const { listingIds } = req.body;
    
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ error: 'Listing IDs array is required' });
    }
    
    const result = await TemplateListing.deleteMany({
      _id: { $in: listingIds }
    });
    
    res.json({ 
      message: 'Listings deleted successfully',
      deletedCount: result.deletedCount 
    });
  } catch (error) {
    console.error('Error bulk deleting listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk create listings from auto-fill results
router.post('/bulk-create', requireAuth, async (req, res) => {
  try {
    const { templateId, sellerId, listings, options = {} } = req.body;
    
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    
    if (!sellerId) {
      return res.status(400).json({ error: 'Seller ID is required' });
    }
    
    // Validate seller exists
    const seller = await Seller.findById(sellerId);
    if (!seller) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return res.status(400).json({ error: 'Listings array is required' });
    }
    
    // Validate batch size
    if (listings.length > 50) {
      return res.status(400).json({ 
        error: 'Maximum 50 listings allowed per batch' 
      });
    }
    
    const {
      autoGenerateSKU = true,
      skipDuplicates = true
    } = options;
    
    // Fetch template to get next SKU counter
    const template = await ListingTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const results = [];
    const errors = [];
    let skippedCount = 0;
    
    // Get existing SKUs for this seller to avoid duplicates
    const existingSKUs = await TemplateListing.find({ 
      templateId,
      sellerId
    }).distinct('customLabel');
    
    const skuSet = new Set(existingSKUs);
    let skuCounter = Date.now();
    
    // Process each listing
    for (const listingData of listings) {
      try {
        // Validate required fields
        if (!listingData.title) {
          errors.push({
            asin: listingData._asinReference,
            error: 'Title is required',
            details: 'Missing required field: title'
          });
          results.push({
            status: 'failed',
            asin: listingData._asinReference,
            error: 'Title is required'
          });
          continue;
        }
        
        if (listingData.startPrice === undefined || listingData.startPrice === null) {
          errors.push({
            asin: listingData._asinReference,
            error: 'Start price is required',
            details: 'Missing required field: startPrice'
          });
          results.push({
            status: 'failed',
            asin: listingData._asinReference,
            error: 'Start price is required'
          });
          continue;
        }
        
        // Generate SKU if not provided
        let sku = listingData.customLabel;
        if (!sku && autoGenerateSKU) {
          // Generate unique SKU
          do {
            sku = listingData._asinReference 
              ? `${listingData._asinReference}-${skuCounter++}`
              : `SKU-${skuCounter++}`;
          } while (skuSet.has(sku));
        }
        
        if (!sku) {
          errors.push({
            asin: listingData._asinReference,
            error: 'SKU (Custom label) is required',
            details: 'No SKU provided and auto-generation disabled'
          });
          results.push({
            status: 'failed',
            asin: listingData._asinReference,
            error: 'SKU is required'
          });
          continue;
        }
        
        // Check for duplicate SKU
        if (skuSet.has(sku)) {
          if (skipDuplicates) {
            skippedCount++;
            results.push({
              status: 'skipped',
              asin: listingData._asinReference,
              sku,
              error: 'Duplicate SKU - skipped'
            });
            continue;
          } else {
            errors.push({
              asin: listingData._asinReference,
              error: 'Duplicate SKU',
              details: `SKU ${sku} already exists`
            });
            results.push({
              status: 'failed',
              asin: listingData._asinReference,
              sku,
              error: 'Duplicate SKU'
            });
            continue;
          }
        }
        
        // Convert customFields object to Map
        const customFieldsMap = listingData.customFields && typeof listingData.customFields === 'object'
          ? new Map(Object.entries(listingData.customFields))
          : new Map();
        
        // Create listing with sellerId
        const listing = new TemplateListing({
          ...listingData,
          customLabel: sku,
          customFields: customFieldsMap,
          templateId,
          sellerId,
          createdBy: req.user.userId
        });
        
        await listing.save();
        skuSet.add(sku);
        
        results.push({
          status: 'created',
          listing: listing.toObject(),
          asin: listingData._asinReference,
          sku
        });
        
      } catch (error) {
        console.error('Error creating listing:', error);
        
        if (error.code === 11000) {
          // Duplicate key error
          skippedCount++;
          results.push({
            status: 'skipped',
            asin: listingData._asinReference,
            error: 'Duplicate SKU'
          });
        } else {
          errors.push({
            asin: listingData._asinReference,
            error: error.message,
            details: error.toString()
          });
          results.push({
            status: 'failed',
            asin: listingData._asinReference,
            error: error.message
          });
        }
      }
    }
    
    const created = results.filter(r => r.status === 'created').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    console.log(`Bulk create completed: ${created} created, ${failed} failed, ${skippedCount} skipped`);
    
    res.json({
      success: true,
      total: listings.length,
      created,
      failed,
      skipped: skippedCount,
      results,
      errors
    });
    
  } catch (error) {
    console.error('Bulk create error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to bulk create listings' 
    });
  }
});

// Bulk import from CSV
router.post('/bulk-import', requireAuth, async (req, res) => {
  try {
    const { templateId, listings } = req.body;
    
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    
    if (!listings || !Array.isArray(listings) || listings.length === 0) {
      return res.status(400).json({ error: 'Listings array is required' });
    }
    
    // Add metadata to each listing
    const listingsToInsert = listings.map(listing => ({
      ...listing,
      templateId,
      createdBy: req.user.userId,
      customFields: listing.customFields 
        ? new Map(Object.entries(listing.customFields))
        : new Map()
    }));
    
    const result = await TemplateListing.insertMany(listingsToInsert, { 
      ordered: false // Continue on error
    });
    
    res.json({ 
      message: 'Listings imported successfully',
      importedCount: result.length 
    });
  } catch (error) {
    if (error.code === 11000) {
      // Some duplicates were found
      const insertedCount = error.insertedDocs ? error.insertedDocs.length : 0;
      return res.status(207).json({ 
        message: 'Import completed with some duplicates skipped',
        importedCount: insertedCount,
        errors: error.writeErrors || []
      });
    }
    console.error('Error bulk importing listings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export listings as eBay CSV
router.get('/export-csv/:templateId', requireAuth, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { sellerId } = req.query;
    
    // Build filter with optional seller filtering
    const filter = { templateId };
    if (sellerId) {
      filter.sellerId = sellerId;
    }
    
    // Fetch template and filtered listings
    const [template, listings] = await Promise.all([
      ListingTemplate.findById(templateId),
      TemplateListing.find(filter).sort({ createdAt: -1 })
    ]);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Build core headers (38 columns)
    const coreHeaders = [
      '*Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
      'Custom label (SKU)',
      'Category ID',
      'Category name',
      'Title',
      'Relationship',
      'Relationship details',
      'Schedule Time',
      'P:UPC',
      'P:EPID',
      'Start price',
      'Quantity',
      'Item photo URL',
      'VideoID',
      'Condition ID',
      'Description',
      'Format',
      'Duration',
      'Buy It Now price',
      'Best Offer Enabled',
      'Best Offer Auto Accept Price',
      'Minimum Best Offer Price',
      'Immediate pay required',
      'Location',
      'Shipping service 1 option',
      'Shipping service 1 cost',
      'Shipping service 1 priority',
      'Shipping service 2 option',
      'Shipping service 2 cost',
      'Shipping service 2 priority',
      'Max dispatch time',
      'Returns accepted option',
      'Returns within option',
      'Refund option',
      'Return shipping cost paid by',
      'Shipping profile name',
      'Return profile name',
      'Payment profile name'
    ];
    
    // Add custom column headers
    const customHeaders = template.customColumns
      .sort((a, b) => a.order - b.order)
      .map(col => col.name);
    
    const allHeaders = [...coreHeaders, ...customHeaders];
    const columnCount = allHeaders.length;
    
    // Generate #INFO lines (must match column count exactly)
    const emptyRow = new Array(columnCount).fill('');
    
    // INFO Line 1: Created timestamp + required field indicator
    const infoLine1 = ['#INFO', `Created=${Date.now()}`, '', '', '', '', 
                       ' Indicates missing required fields', '', '', '', '',
                       ' Indicates missing field that will be required soon',
                       ...new Array(columnCount - 12).fill('')];
    
    // INFO Line 2: Version + recommended field indicator  
    const infoLine2 = ['#INFO', 'Version=1.0', '', 
                       'Template=fx_category_template_EBAY_US', '', '',
                       ' Indicates missing recommended field', '', '', '', '',
                       ' Indicates field does not apply to this item/category',
                       ...new Array(columnCount - 12).fill('')];
    
    // INFO Line 3: All empty commas
    const infoLine3 = new Array(columnCount).fill('')
    infoLine3[0] = '#INFO';
    
    // Map listings to CSV rows
    const dataRows = listings.map(listing => {
      // Add leading slash to category name if not present
      let categoryName = listing.categoryName || '';
      if (categoryName && !categoryName.startsWith('/')) {
        categoryName = '/' + categoryName;
      }
      
      const coreValues = [
        listing.action || 'Add',
        listing.customLabel || '',
        listing.categoryId || '',
        categoryName,
        listing.title || '',
        listing.relationship || '',
        listing.relationshipDetails || '',
        listing.scheduleTime || '',
        listing.upc || '',
        listing.epid || '',
        listing.startPrice || '',
        listing.quantity || '',
        listing.itemPhotoUrl || '',
        listing.videoId || '',
        listing.conditionId || '1000-New',
        listing.description || '',
        listing.format || 'FixedPrice',
        listing.duration || 'GTC',
        listing.buyItNowPrice || '',
        listing.bestOfferEnabled || '',
        listing.bestOfferAutoAcceptPrice || '',
        listing.minimumBestOfferPrice || '',
        listing.immediatePayRequired || '',
        listing.location || 'UnitedStates',
        listing.shippingService1Option || '',
        listing.shippingService1Cost || '',
        listing.shippingService1Priority || '',
        listing.shippingService2Option || '',
        listing.shippingService2Cost || '',
        listing.shippingService2Priority || '',
        listing.maxDispatchTime || '',
        listing.returnsAcceptedOption || '',
        listing.returnsWithinOption || '',
        listing.refundOption || '',
        listing.returnShippingCostPaidBy || '',
        listing.shippingProfileName || '',
        listing.returnProfileName || '',
        listing.paymentProfileName || ''
      ];
      
      // Get custom field values in order
      const customValues = template.customColumns
        .sort((a, b) => a.order - b.order)
        .map(col => listing.customFields.get(col.name) || '');
      
      return [...coreValues, ...customValues];
    });
    
    // Combine all rows
    const allRows = [infoLine1, infoLine2, infoLine3, allHeaders, ...dataRows];
    
    // Convert to CSV string with proper escaping
    const csvContent = allRows.map(row => 
      row.map(cell => {
        const value = String(cell || '');
        // Escape quotes and wrap in quotes if contains comma/quote/newline
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    ).join('\n');
    
    // Send as downloadable file
    const filename = `${template.name.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
    
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
