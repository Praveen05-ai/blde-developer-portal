import db from '../db/connection.js';
import { verifySignature, parseFeatures } from './licenseService.js';

/**
 * Retrieves the currently active license feature set.
 */
async function getActiveFeatures() {
  try {
    const license = await db('licenses').orderBy('id', 'desc').first();
    if (!license || license.status === 'suspended' || license.status === 'revoked') {
      return {};
    }

    // Expiry check
    const now = new Date();
    if (license.expiry_date && now > new Date(license.expiry_date)) {
      return {}; // Expired license features are disabled
    }

    const secret = process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';
    const payload = verifySignature(license.license_key, secret);
    return parseFeatures(payload);
  } catch (err) {
    return {};
  }
}

export async function isSurveyEnabled() {
  const features = await getActiveFeatures();
  return !!features.survey_module;
}

export async function isApiAccessEnabled() {
  const features = await getActiveFeatures();
  return !!features.api_access;
}

export async function isExportPdfEnabled() {
  const features = await getActiveFeatures();
  return !!features.export_pdf;
}

export async function isRandomizationEnabled() {
  const features = await getActiveFeatures();
  return !!features.randomization_module;
}

export async function isESignatureEnabled() {
  const features = await getActiveFeatures();
  return !!features.esignature;
}

export async function isMobileAccessEnabled() {
  const features = await getActiveFeatures();
  return !!features.mobile_access;
}

/**
 * Express middleware helper to enforce a feature requirement.
 */
export function requireFeature(featureName, displayName) {
  return async (req, res, next) => {
    const license = await db('licenses').orderBy('id', 'desc').first().catch(() => null);
    
    let isEnabled = false;
    if (featureName === 'survey_module') isEnabled = await isSurveyEnabled();
    else if (featureName === 'api_access') isEnabled = await isApiAccessEnabled();
    else if (featureName === 'export_pdf') isEnabled = await isExportPdfEnabled();
    else if (featureName === 'randomization_module') isEnabled = await isRandomizationEnabled();
    else if (featureName === 'esignature') isEnabled = await isESignatureEnabled();
    else if (featureName === 'mobile_access') isEnabled = await isMobileAccessEnabled();

    if (!isEnabled) {
      if (license) {
        await db('license_logs').insert({
          license_id: license.id,
          action: 'limit_breach',
          details: `Feature disabled attempt: ${displayName || featureName}`,
          timestamp: new Date()
        }).catch(() => {});
      }
      return res.status(403).json({ error: `Feature ${displayName || featureName} is not enabled under the current license.` });
    }

    next();
  };
}
