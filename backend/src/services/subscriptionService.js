import db from '../db/connection.js';
import { generateLicenseKey } from './licenseService.js';
import { generateInvoice } from './invoiceService.js';

const getSecret = () => process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';

/**
 * Creates a subscription for a customer.
 */
export async function createSubscription(customerId, planId, options = {}) {
  const plan = await db('subscription_plans').where({ id: planId }).first();
  if (!plan) throw new Error('Subscription plan not found');

  const customer = await db('customers').where({ id: customerId }).first();
  if (!customer) throw new Error('Customer not found');

  const start = options.start_date ? new Date(options.start_date) : new Date();
  let end = null;
  if (plan.duration_days && plan.duration_days < 99999) {
    end = new Date(start.getTime() + plan.duration_days * 24 * 3600 * 1000);
  }

  // Insert subscription in payment_pending status
  const [subId] = await db('subscriptions').insert({
    customer_id: customerId,
    plan_id: planId,
    subscription_version: 1,
    parent_subscription_id: null,
    start_date: start,
    end_date: end,
    renewal_date: end,
    status: plan.amount === 0 ? 'active' : 'payment_pending',
    auto_renew: options.auto_renew || false,
    grace_days: options.grace_days !== undefined ? options.grace_days : 7,
    notes: options.notes || `Created ${plan.plan_name} subscription`,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('id');

  const subIdVal = typeof subId === 'object' ? (subId.id || Object.values(subId)[0]) : subId;

  // Insert billing log for creation
  await db('billing_logs').insert({
    customer_id: customerId,
    subscription_id: subIdVal,
    action: 'payment_pending',
    details: `Subscription created for plan ${plan.plan_name}. Status: ${plan.amount === 0 ? 'active' : 'payment_pending'}. Amount: ${plan.currency} ${plan.amount}`,
    created_at: new Date()
  });

  // Generate invoice
  const invoice = await generateInvoice(subIdVal);

  // If Trial (₹0), immediately activate subscription & create license!
  if (plan.amount === 0) {
    const license = await activateLicenseForSubscription(subIdVal);
    // Mark invoice as paid
    await db('invoices').where({ id: invoice.id }).update({
      status: 'paid',
      payment_method: 'Cash',
      notes: 'Auto-paid Trial Plan',
      updated_at: new Date()
    });
    // Log payment
    const [payId] = await db('payments').insert({
      invoice_id: invoice.id,
      transaction_reference: `TXN-TRIAL-${subIdVal}-${Date.now()}`,
      amount: 0,
      currency: 'INR',
      payment_date: new Date(),
      payment_method: 'Cash',
      status: 'success',
      notes: 'Trial auto-activation',
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');

    const payIdVal = typeof payId === 'object' ? (payId.id || Object.values(payId)[0]) : payId;

    await db('billing_logs').insert({
      customer_id: customerId,
      subscription_id: subIdVal,
      invoice_id: invoice.id,
      payment_id: payIdVal,
      action: 'payment_received',
      details: 'Trial subscription payment recorded automatically (free plan).',
      created_at: new Date()
    });
  }

  return await db('subscriptions').where({ id: subIdVal }).first();
}

/**
 * Renews subscription: preserves old one, increments version, creates payment_pending renewal.
 */
export async function renewSubscription(subscriptionId, options = {}) {
  const oldSub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!oldSub) throw new Error('Subscription not found');

  const planId = options.planId || oldSub.plan_id;
  const plan = await db('subscription_plans').where({ id: planId }).first();
  if (!plan) throw new Error('Plan not found');

  // Increment version
  const nextVersion = (oldSub.subscription_version || 1) + 1;

  // Determine dates starting from oldSub end_date or now (whichever is later)
  const start = (oldSub.end_date && new Date(oldSub.end_date) > new Date()) ? new Date(oldSub.end_date) : new Date();
  let end = null;
  if (plan.duration_days && plan.duration_days < 99999) {
    end = new Date(start.getTime() + plan.duration_days * 24 * 3600 * 1000);
  }

  const [newSubId] = await db('subscriptions').insert({
    customer_id: oldSub.customer_id,
    plan_id: planId,
    subscription_version: nextVersion,
    parent_subscription_id: oldSub.id,
    start_date: start,
    end_date: end,
    renewal_date: end,
    status: 'payment_pending',
    auto_renew: oldSub.auto_renew,
    grace_days: oldSub.grace_days,
    notes: options.notes || `Renewal version ${nextVersion} from subscription #${oldSub.id}`,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('id');

  const newSubIdVal = typeof newSubId === 'object' ? (newSubId.id || Object.values(newSubId)[0]) : newSubId;

  // Create renewal invoice
  await generateInvoice(newSubIdVal);

  await db('billing_logs').insert({
    customer_id: oldSub.customer_id,
    subscription_id: newSubIdVal,
    action: 'payment_pending',
    details: `Renewal subscription version ${nextVersion} created. Invoice generated. Pending payment.`,
    created_at: new Date()
  });

  return await db('subscriptions').where({ id: newSubIdVal }).first();
}

/**
 * Extends the subscription end date.
 */
export async function extendSubscription(subscriptionId, days, options = {}) {
  const sub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  const currentEnd = sub.end_date ? new Date(sub.end_date) : new Date();
  const newEnd = new Date(currentEnd.getTime() + days * 24 * 3600 * 1000);

  await db('subscriptions').where({ id: subscriptionId }).update({
    end_date: newEnd,
    renewal_date: newEnd,
    updated_at: new Date()
  });

  // If active license is linked, regenerate/re-sign license key with new expiration date
  if (sub.license_id) {
    await updateLicenseExpiration(sub.license_id, newEnd);
  }

  await db('billing_logs').insert({
    customer_id: sub.customer_id,
    subscription_id: subscriptionId,
    action: 'renewal_success', // using renewal success to represent extension
    details: `Subscription extended by ${days} days. New expiry: ${newEnd.toISOString().split('T')[0]}`,
    created_at: new Date()
  });

  return await db('subscriptions').where({ id: subscriptionId }).first();
}

/**
 * Cancels subscription (sets status to cancelled).
 */
export async function cancelSubscription(subscriptionId, options = {}) {
  const sub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  await db('subscriptions').where({ id: subscriptionId }).update({
    status: 'cancelled',
    updated_at: new Date()
  });

  // Deactivate linked license
  if (sub.license_id) {
    await db('licenses').where({ id: sub.license_id }).update({
      status: 'suspended',
      remote_status: 'suspended',
      remote_status_reason: 'Subscription cancelled.',
      updated_at: new Date()
    });

    await db('license_logs').insert({
      license_id: sub.license_id,
      action: 'remote_suspend',
      details: 'License suspended due to subscription cancellation.',
      timestamp: new Date()
    }).catch(() => {});
  }

  await db('billing_logs').insert({
    customer_id: sub.customer_id,
    subscription_id: subscriptionId,
    action: 'invoice_cancelled',
    details: `Subscription cancelled. Reasons/Notes: ${options.notes || 'None'}`,
    created_at: new Date()
  });

  return await db('subscriptions').where({ id: subscriptionId }).first();
}

/**
 * Archives subscription (soft delete status).
 */
export async function archiveSubscription(subscriptionId) {
  const sub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  await db('subscriptions').where({ id: subscriptionId }).update({
    status: 'archived',
    updated_at: new Date()
  });

  // Soft-delete corresponding license
  if (sub.license_id) {
    await db('licenses').where({ id: sub.license_id }).update({
      status: 'revoked',
      remote_status: 'revoked',
      updated_at: new Date()
    });
  }

  return await db('subscriptions').where({ id: subscriptionId }).first();
}

/**
 * Calculates remaining days of a subscription.
 */
export function calculateRemainingDays(subscription) {
  if (!subscription || !subscription.end_date) return 9999; // Unlimited
  const expiry = new Date(subscription.end_date);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Helper to update linked license expiration date.
 */
async function updateLicenseExpiration(licenseId, newExpiryDate) {
  try {
    const license = await db('licenses').where({ id: licenseId }).first();
    if (!license) return;

    // Get current payload
    const parts = license.license_key.split('.');
    const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
    const envelope = JSON.parse(payloadStr);

    // Update expiry in payload
    envelope.data.expiry_date = newExpiryDate.toISOString();

    // Re-sign
    const newLicenseKey = generateLicenseKey(envelope.data, getSecret());
    const signature = newLicenseKey.split('.')[1];

    await db('licenses').where({ id: licenseId }).update({
      license_key: newLicenseKey,
      expiry_date: newExpiryDate,
      signature: signature,
      updated_at: new Date()
    });
  } catch (err) {
    console.error('Failed to update license expiration:', err);
  }
}

/**
 * Generates and activates a license key for an active subscription.
 */
export async function activateLicenseForSubscription(subscriptionId) {
  const sub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  const plan = await db('subscription_plans').where({ id: sub.plan_id }).first();
  if (!plan) throw new Error('Plan not found');

  // Sequential License String Generation
  const maxLic = await db('licenses').max('id as maxId').first();
  const nextLicId = (maxLic.maxId || 0) + 1;
  const licenseIdStr = `LIC-${String(nextLicId).padStart(6, '0')}`;

  const parsedLimits = {
    max_projects: plan.max_projects === 999999 ? null : plan.max_projects,
    max_users: plan.max_users === 999999 ? null : plan.max_users,
    max_forms: plan.max_forms === 999999 ? null : plan.max_forms,
    max_records: plan.max_records === 999999 ? null : plan.max_records,
    max_storage_gb: plan.max_storage_gb === 9999 ? null : plan.max_storage_gb,
    max_upload_size_mb: plan.max_upload_mb === 5000 ? null : plan.max_upload_mb,
    max_sessions: plan.max_sessions === 9999 ? null : plan.max_sessions
  };

  // Enable features selectively based on plan
  const features = {
    survey_module: true,
    api_access: plan.plan_code !== 'TRIAL',
    export_excel: plan.plan_code !== 'TRIAL',
    export_csv: true,
    export_pdf: true,
    file_attachments: true,
    randomization_module: plan.plan_code !== 'TRIAL' && plan.plan_code !== 'SINGLE_USER',
    esignature: plan.plan_code !== 'TRIAL',
    notifications: true,
    mobile_access: plan.plan_code !== 'TRIAL',
    backup_restore: plan.plan_code === 'INSTITUTION' || plan.plan_code === 'LIFETIME',
    custom_branding: plan.plan_code === 'INSTITUTION' || plan.plan_code === 'LIFETIME'
  };

  const licensePayload = {
    license_type: plan.license_type,
    activation_date: sub.start_date ? new Date(sub.start_date).toISOString() : new Date().toISOString(),
    expiry_date: sub.end_date ? new Date(sub.end_date).toISOString() : null,
    organization_id: null,
    machine_id: null,
    limits: parsedLimits,
    features: features
  };

  const licenseKey = generateLicenseKey(licensePayload, getSecret());
  const signature = licenseKey.split('.')[1];

  const [licId] = await db('licenses').insert({
    license_key: licenseKey,
    license_type: plan.license_type,
    status: 'active',
    activation_date: sub.start_date ? new Date(sub.start_date) : new Date(),
    expiry_date: sub.end_date ? new Date(sub.end_date) : null,
    machine_id: null,
    organization_id: null,
    signature: signature,
    license_id_str: licenseIdStr,
    license_version: sub.subscription_version,
    customer_id: sub.customer_id,
    notes: `Generated automatically for ${plan.plan_name} subscription version ${sub.subscription_version}`,
    subscription_plan: plan.plan_name,
    payment_status: 'paid',
    amount: plan.amount,
    currency: plan.currency,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('id');

  const licIdVal = typeof licId === 'object' ? (licId.id || Object.values(licId)[0]) : licId;

  // Insert usage limits
  await db('license_usage').insert({
    license_id: licIdVal,
    max_projects: parsedLimits.max_projects,
    max_users: parsedLimits.max_users,
    max_forms: parsedLimits.max_forms,
    max_records: parsedLimits.max_records,
    max_storage_gb: parsedLimits.max_storage_gb,
    max_upload_size_mb: parsedLimits.max_upload_size_mb,
    max_sessions: parsedLimits.max_sessions
  });

  // Insert features
  await db('license_features').insert({
    license_id: licIdVal,
    ...features
  });

  // Link license back to subscription
  await db('subscriptions').where({ id: sub.id }).update({
    license_id: licIdVal,
    updated_at: new Date()
  });

  // Log GxP audit trail
  await db('license_logs').insert({
    license_id: licIdVal,
    action: 'verification_success',
    details: `License key activated automatically via subscription billing layer. Plan: ${plan.plan_name}`,
    timestamp: new Date()
  });

  return licIdVal;
}
