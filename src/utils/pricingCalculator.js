/**
 * Pricing Calculator Utility
 * 
 * Calculates eBay listing start price based on Amazon cost and template pricing configuration
 * 
 * Formula:
 * StartPrice = (
 *   (desiredProfit + (buyingPrice * spentRate)) / payoutRate + fixedFee
 * ) / (
 *   1 - (1 + saleTax/100) * (ebayFee/100 + adsFee/100 + tdsFee/100)
 * )
 * 
 * Where:
 * - buyingPrice (USD) = cost + shipping + tax
 * - tax (USD) = cost * (taxRate/100)
 */

/**
 * Calculate Start Price based on template pricing config and Amazon cost
 * 
 * @param {Object} pricingConfig - Template pricing configuration
 * @param {Number} pricingConfig.spentRate - USD to INR conversion rate for expenses
 * @param {Number} pricingConfig.payoutRate - USD to INR conversion rate for payouts
 * @param {Number} pricingConfig.desiredProfit - Desired profit in INR
 * @param {Number} pricingConfig.fixedFee - Fixed transaction fee in INR
 * @param {Number} pricingConfig.saleTax - Sales tax percentage
 * @param {Number} pricingConfig.ebayFee - eBay fee percentage
 * @param {Number} pricingConfig.adsFee - Ads fee percentage
 * @param {Number} pricingConfig.tdsFee - TDS fee percentage
 * @param {Number} pricingConfig.shippingCost - Shipping cost in USD
 * @param {Number} pricingConfig.taxRate - Tax rate on cost percentage
 * @param {Number} amazonCost - Cost from Amazon ASIN (in USD)
 * @returns {Object} { price: Number, breakdown: Object }
 * @throws {Error} If validation fails
 */
export function calculateStartPrice(pricingConfig, amazonCost) {
  // Validate inputs
  validatePricingConfig(pricingConfig);
  
  if (!amazonCost || isNaN(amazonCost) || amazonCost <= 0) {
    throw new Error('Invalid Amazon cost. Must be a positive number.');
  }
  
  // Extract values with defaults
  const {
    spentRate,
    payoutRate,
    desiredProfit,
    fixedFee = 0,
    saleTax = 0,
    ebayFee = 12.9,
    adsFee = 3,
    tdsFee = 1,
    shippingCost = 0,
    taxRate = 10
  } = pricingConfig;
  
  // Step 1: Calculate Tax($) = Cost($) * (taxRate/100)
  const taxUSD = amazonCost * (taxRate / 100);
  
  // Step 2: Calculate BuyingPrice($) = Cost($) + Ship($) + Tax($)
  const buyingPriceUSD = amazonCost + shippingCost + taxUSD;
  
  // Step 3: Convert BuyingPrice to INR using SpentRate
  const buyingPriceINR = buyingPriceUSD * spentRate;
  
  // Step 4: Add desired profit
  const profitComponent = desiredProfit + buyingPriceINR;
  
  // Step 5: Convert back to USD using PayoutRate
  const payoutUSD = profitComponent / payoutRate;
  
  // Step 6: Add fixed fee (convert from INR to USD)
  const withFixedFee = payoutUSD + (fixedFee / payoutRate);
  
  // Step 7: Calculate fee multiplier
  // 1 - (1 + SaleTax%) * (eBayFee% + Ads% + TDS%)
  const combinedFees = (ebayFee / 100) + (adsFee / 100) + (tdsFee / 100);
  const saleTaxMultiplier = 1 + (saleTax / 100);
  const feeMultiplier = 1 - (saleTaxMultiplier * combinedFees);
  
  if (feeMultiplier <= 0) {
    throw new Error('Invalid fee configuration. Fee multiplier must be positive. Check your percentage values.');
  }
  
  // Step 8: Final price
  const finalPrice = withFixedFee / feeMultiplier;
  
  // Validate result
  if (!isFinite(finalPrice) || finalPrice <= 0) {
    throw new Error('Calculated price is invalid. Please check your pricing configuration.');
  }
  
  // Round to 2 decimal places
  const roundedPrice = Math.round(finalPrice * 100) / 100;
  
  // Return price and breakdown for transparency
  return {
    price: roundedPrice,
    breakdown: {
      cost: amazonCost,
      shipping: shippingCost,
      taxRate: taxRate,
      tax: Math.round(taxUSD * 100) / 100,
      buyingPriceUSD: Math.round(buyingPriceUSD * 100) / 100,
      buyingPriceINR: Math.round(buyingPriceINR * 100) / 100,
      desiredProfit: desiredProfit,
      profitComponent: Math.round(profitComponent * 100) / 100,
      payoutUSD: Math.round(payoutUSD * 100) / 100,
      fixedFee: fixedFee,
      withFixedFee: Math.round(withFixedFee * 100) / 100,
      feeMultiplier: Math.round(feeMultiplier * 10000) / 10000,
      finalPrice: roundedPrice
    }
  };
}

/**
 * Validate pricing config has all required fields
 * @param {Object} config - Pricing configuration to validate
 * @throws {Error} If validation fails
 */
export function validatePricingConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Pricing config is required');
  }
  
  // Required fields
  const requiredFields = ['spentRate', 'payoutRate', 'desiredProfit'];
  
  for (const field of requiredFields) {
    if (!config[field] || isNaN(config[field]) || config[field] <= 0) {
      throw new Error(`${field} is required and must be a positive number`);
    }
  }
  
  // Validate percentage fields (0-100)
  const percentageFields = ['saleTax', 'ebayFee', 'adsFee', 'tdsFee', 'taxRate'];
  
  for (const field of percentageFields) {
    if (config[field] !== undefined && config[field] !== null) {
      const value = config[field];
      if (isNaN(value) || value < 0 || value > 100) {
        throw new Error(`${field} must be between 0 and 100`);
      }
    }
  }
  
  // Validate non-negative fields
  const nonNegativeFields = ['fixedFee', 'shippingCost'];
  
  for (const field of nonNegativeFields) {
    if (config[field] !== undefined && config[field] !== null) {
      const value = config[field];
      if (isNaN(value) || value < 0) {
        throw new Error(`${field} must be non-negative`);
      }
    }
  }
}

/**
 * Get default pricing config
 * @returns {Object} Default pricing configuration
 */
export function getDefaultPricingConfig() {
  return {
    enabled: false,
    spentRate: null,
    payoutRate: null,
    desiredProfit: null,
    fixedFee: 0,
    saleTax: 0,
    ebayFee: 12.9,
    adsFee: 3,
    tdsFee: 1,
    shippingCost: 0,
    taxRate: 10
  };
}
