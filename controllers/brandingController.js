const asyncHandler = require('express-async-handler');
const { Op } = require('sequelize');
const Company = require('../models/Company');

/**
 * Normalizes a domain name:
 * Lowercases, strips protocol, port, path, query, hash, and leading 'www.'.
 */
function sanitizeDomain(domain) {
  if (!domain || typeof domain !== 'string') return '';
  let clean = domain.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  clean = clean.replace(/^www\./i, '');
  return clean.trim();
}

/**
 * Resolves the full URL for a company logo.
 * If already absolute (e.g. Cloudinary HTTPS URL), returns as-is.
 * If relative (/uploads/...), prepends server origin.
 */
function resolveFullImageUrl(req, relativeOrAbsoluteUrl) {
  if (!relativeOrAbsoluteUrl || typeof relativeOrAbsoluteUrl !== 'string') {
    return null;
  }
  const trimmed = relativeOrAbsoluteUrl.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Prepend current request's origin or configured frontend/backend URL
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const protocol = req.protocol || 'http';
  const host = req.get('host') || 'localhost:5001';
  return `${protocol}://${host}${cleanPath}`;
}

/**
 * GET /api/branding/current
 * Resolves tenant branding dynamically from the verified registered domain and current DB.
 */
const getCurrentBranding = asyncHandler(async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  const isTrustProxy = Boolean(req.app && req.app.get('trust proxy'));

  // 1. Determine incoming host securely
  // Only trust X-Forwarded-Host if Express trust proxy is enabled
  let incomingHost = '';
  if (isTrustProxy && req.headers['x-forwarded-host']) {
    incomingHost = String(req.headers['x-forwarded-host']).split(',')[0].trim();
  }

  if (!incomingHost) {
    incomingHost = req.headers['host'] || req.hostname || '';
  }

  const cleanHost = sanitizeDomain(incomingHost);

  // 2. Local development & test explicit overrides
  // NEVER allow query/header domain overrides in production mode
  let targetDomain = cleanHost;
  if (!isProduction) {
    const isLocalhost = cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '';
    const devRequestedDomain = req.query?.dev_domain || req.headers['x-dev-tenant-domain'] || process.env.DEV_TENANT_DOMAIN;

    if (devRequestedDomain && (isLocalhost || isTest)) {
      targetDomain = sanitizeDomain(devRequestedDomain);
    }
  }

  const defaultBranding = {
    companyName: 'ABHEEPAY',
    companyLogoUrl: null,
    faviconUrl: null,
    domain: targetDomain || 'localhost',
    isDefault: true,
  };

  if (!targetDomain) {
    return res.json({
      success: true,
      data: defaultBranding,
    });
  }

  try {
    // 3. Database query: find active Company by registered domain_name
    let company = await Company.findOne({
      where: {
        [Op.or]: [
          { domain_name: targetDomain },
          { domain_name: `www.${targetDomain}` },
        ],
        status: 'active',
      },
    });

    // If target domain had a sub-domain variation or port difference, try exact match
    if (!company) {
      company = await Company.findOne({
        where: {
          domain_name: targetDomain,
        },
      });
    }

    // 4. If no registered company matches this domain, return safe default platform branding
    // Do NOT silently map to an unrelated tenant or arbitrary default company
    if (!company) {
      return res.json({
        success: true,
        data: defaultBranding,
      });
    }

    // 5. Construct resolved response
    const resolvedLogoUrl = resolveFullImageUrl(req, company.company_logo);
    const resolvedFaviconUrl = resolvedLogoUrl; // Logo serves as favicon or fallback

    return res.json({
      success: true,
      data: {
        companyName: company.company_name,
        companyLogoUrl: resolvedLogoUrl,
        faviconUrl: resolvedFaviconUrl,
        domain: company.domain_name,
        isDefault: false,
      },
    });
  } catch (error) {
    console.error('[Branding API Error]:', error);
    // On unexpected database error, safely return fallback instead of breaking client
    return res.json({
      success: true,
      data: defaultBranding,
    });
  }
});

module.exports = {
  getCurrentBranding,
  sanitizeDomain,
  resolveFullImageUrl,
};

