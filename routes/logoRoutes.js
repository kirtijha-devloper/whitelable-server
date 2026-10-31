const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Company = require('../models/Company');

/**
 * GET /api/logo
 * Extracts domain from req.headers['origin'] and returns logo + company_name.
 * Response: { success: true, logo: <url|null>, company_name: <string> }
 */
router.get('/', async (req, res) => {
  try {
    const origin = req.headers['origin'] || '';

    const domain = new URL(origin).hostname;

    if (!domain) {
      console.warn('[logoRoutes] domain could not be resolved from origin header');
      return res.status(400).json({ success: false, message: 'Could not resolve domain from origin header' });
    }

    const company = await Company.findOne({
      where: { domain_name: domain },
      attributes: ['company_logo', 'company_name']
    });

    if (!company) {
      console.warn(`[logoRoutes] No company found for domain: "${domain}"`);
      return res.status(404).json({ success: false, message: 'No company found for this domain' });
    }

    let logo = null;

    if (company.company_logo) {
      // Option 1: Cloudinary or any external URL
      if (/^https?:\/\//i.test(company.company_logo)) {
        logo = company.company_logo;
        console.log(`[logoRoutes] Logo source: Cloudinary/external → ${logo}`);
      } else {
        // Option 2 (fallback): Local uploads
        const logoPath = path.isAbsolute(company.company_logo)
          ? path.join(__dirname, '..', company.company_logo)
          : path.join(__dirname, '..', company.company_logo);

          console.log(`[logoRoutes] Checking local file existence at path: "${logoPath}"`);

        console.log(`[logoRoutes] Logo source: local uploads | resolved path: "${logoPath}"`);

        if (fs.existsSync(logoPath)) {
          const relativePath = company.company_logo.replace(/\\/g, '/').replace(/^\//, '');
          logo = `${req.protocol}://${req.get('host')}/${relativePath}`;
          console.log(`[logoRoutes] Local file found → ${logo}`);
        } else {
          console.warn(`[logoRoutes] Local file NOT found at path: "${logoPath}" → logo will be null`);
        }
      }
    } else {
      console.warn(`[logoRoutes] company_logo is empty for company: "${company.company_name}"`);
    }

    console.log(`[logoRoutes] Response → company_name: "${company.company_name}" | logo: ${logo}`);
    return res.status(200).json({
      success: true,
      logo,
      company_name: company.company_name
    });
  } catch (err) {
    console.error('[logoRoutes] Unexpected error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
