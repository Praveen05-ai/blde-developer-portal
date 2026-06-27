import db from './src/db/connection.js';
import * as subService from './src/services/subscriptionService.js';
import * as invService from './src/services/invoiceService.js';
import * as payService from './src/services/paymentService.js';
import { checkExpiringSubscriptions } from './src/services/renewalService.js';
import { verifyLicenseMiddleware } from './src/middleware/licenseVerifier.js';
import { verifySignature, generateLicenseKey } from './src/services/licenseService.js';

async function runTests() {
  console.log('🧪 STARTING PHASE 7 - SUBSCRIPTION & BILLING TEST SUITE...\n');

  let testCustomer = null;
  let testPlan = null;
  let testSub = null;
  let testInv = null;
  let testPayment = null;

  try {
    // -------------------------------------------------------------------------
    // 1. SETUP TEST CUSTOMER & PLAN
    // -------------------------------------------------------------------------    // Clean up prior runs if aborted
    await db('customers').where({ customer_id: 'CUS-TEST99' }).del().catch(() => {});
    await db('subscription_plans').where({ plan_code: 'TEST_PLAN' }).del().catch(() => {});

    console.log('🔹 1. Setting up Test Customer...');
    const [custId] = await db('customers').insert({
      customer_id: 'CUS-TEST99',
      name: 'Billing Test Customer',
      organization: 'BLDE Test Lab',
      email: 'test@blde.ac.in',
      archived: false,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');
    const custIdVal = typeof custId === 'object' ? (custId.id || Object.values(custId)[0]) : custId;
    testCustomer = await db('customers').where({ id: custIdVal }).first();
    console.log(`   Created test customer: ${testCustomer.name} (ID: ${testCustomer.id})`);

    console.log('\n🔹 2. Creating Custom Subscription Plan...');
    // Create custom test plan
    const [planId] = await db('subscription_plans').insert({
      plan_code: 'TEST_PLAN',
      plan_name: 'Test Plan 1 Year',
      license_type: 'single',
      duration_days: 365,
      amount: 12000.00,
      currency: 'INR',
      max_projects: 5,
      max_users: 2,
      max_forms: 15,
      max_records: 5000,
      max_storage_gb: 10,
      max_upload_mb: 20,
      max_sessions: 5,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');
    const planIdVal = typeof planId === 'object' ? (planId.id || Object.values(planId)[0]) : planId;
    testPlan = await db('subscription_plans').where({ id: planIdVal }).first();
    console.log(`   Created custom plan: ${testPlan.plan_name} (Amount: ₹${testPlan.amount})`);

    // -------------------------------------------------------------------------
    // 2. TEST SUBSCRIPTION CREATION
    // -------------------------------------------------------------------------
    console.log('\n🔹 3. Testing Subscription Creation...');
    testSub = await subService.createSubscription(testCustomer.id, testPlan.id, {
      auto_renew: true,
      grace_days: 5,
      notes: 'Initial test purchase'
    });
    
    if (testSub.status !== 'payment_pending') {
      throw new Error(`Expected subscription status 'payment_pending', got '${testSub.status}'`);
    }
    console.log(`   Created subscription version ${testSub.subscription_version} in status '${testSub.status}'`);

    // -------------------------------------------------------------------------
    // 3. TEST INVOICE GENERATION
    // -------------------------------------------------------------------------
    console.log('\n🔹 4. Testing Invoice Generation & Sequential Numbering...');
    testInv = await db('invoices').where({ subscription_id: testSub.id }).first();
    if (!testInv) throw new Error('Invoice not automatically generated for subscription');

    console.log(`   Invoice Number: ${testInv.invoice_number}`);
    if (!testInv.invoice_number.startsWith('INV-')) {
      throw new Error(`Invalid invoice number format: ${testInv.invoice_number}`);
    }

    // Verify PDF generation
    const pdfBuffer = await invService.downloadInvoicePdf(testInv.id);
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new Error('PDF Generation did not return a valid Buffer');
    }
    const pdfHeader = pdfBuffer.toString('utf8', 0, 5);
    if (pdfHeader !== '%PDF-') {
      throw new Error(`PDF Header is invalid: ${pdfHeader}`);
    }
    console.log('   ✓ Native PDF stream generated successfully with correct header');

    // -------------------------------------------------------------------------
    // 4. TEST PAYMENTS RECORDING & ACTIVATION
    // -------------------------------------------------------------------------
    console.log('\n🔹 5. Testing Payment Recording & Subscription Activation...');
    testPayment = await payService.recordPayment(testInv.id, {
      transaction_reference: 'TXN-TEST-1001-' + Date.now(),
      payment_method: 'UPI',
      notes: 'Simulated UPI payment'
    });
    console.log(`   Recorded payment in status '${testPayment.status}'`);

    // Mark paid
    await payService.markPaymentSuccess(testPayment.id, 'TXN-SUCCESS-1001-' + Date.now());
    
    // Verify invoice and subscription updated
    const updatedInv = await db('invoices').where({ id: testInv.id }).first();
    const updatedSub = await db('subscriptions').where({ id: testSub.id }).first();
    
    if (updatedInv.status !== 'paid') {
      throw new Error(`Expected invoice status 'paid', got '${updatedInv.status}'`);
    }
    if (updatedSub.status !== 'active' || !updatedSub.license_id) {
      throw new Error(`Expected subscription 'active' with linked license_id, got status '${updatedSub.status}'`);
    }
    console.log(`   ✓ Invoice marked 'paid'. Subscription activated & linked to license ID: ${updatedSub.license_id}`);

    // Verify cryptographic license signature
    const license = await db('licenses').where({ id: updatedSub.license_id }).first();
    const secret = process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';
    const payload = verifySignature(license.license_key, secret);
    
    console.log(`   ✓ Cryptographic license verified successfully. Type: ${payload.license_type}`);
    if (payload.limits.max_projects !== testPlan.max_projects) {
      throw new Error('License limit mismatch for max_projects');
    }

    // -------------------------------------------------------------------------
    // 5. TEST ANNUAL RENEWALS
    // -------------------------------------------------------------------------
    console.log('\n🔹 6. Testing Subscription Renewal (Versioning)...');
    const renewalSub = await subService.renewSubscription(updatedSub.id, {
      notes: 'Year 2 renewal'
    });
    
    if (renewalSub.subscription_version !== 2 || renewalSub.parent_subscription_id !== updatedSub.id) {
      throw new Error('Renewal subscription versioning link failed');
    }
    console.log(`   ✓ Renewal subscription version ${renewalSub.subscription_version} queued successfully`);

    const renewalInv = await db('invoices').where({ subscription_id: renewalSub.id }).first();
    const renewalPayment = await payService.recordPayment(renewalInv.id, {
      transaction_reference: 'TXN-RENEW-1002-' + Date.now(),
      payment_method: 'Bank Transfer'
    });
    
    // Mark renewal payment success
    await payService.markPaymentSuccess(renewalPayment.id, 'TXN-RENEW-SUCCESS-' + Date.now());
    
    const activeRenewalSub = await db('subscriptions').where({ id: renewalSub.id }).first();
    const preservedParentSub = await db('subscriptions').where({ id: updatedSub.id }).first();
    
    if (activeRenewalSub.status !== 'active') {
      throw new Error('Renewed subscription not activated');
    }
    if (preservedParentSub.status !== 'renewed') {
      throw new Error(`Parent subscription status should be 'renewed', got '${preservedParentSub.status}'`);
    }
    console.log('   ✓ Renewal payment processed. Old subscription preserved as "renewed", new version is "active".');

    // -------------------------------------------------------------------------
    // 6. TEST GRACE PERIODS & LOCKOUTS
    // -------------------------------------------------------------------------
    console.log('\n🔹 7. Testing Grace Period Entry & Expiration Lockout...');
    
    // Fast-forward dates back to simulate expiration
    const expiredEndDate = new Date(Date.now() - 2 * 24 * 3600 * 1000); // 2 days ago
    await db('subscriptions').where({ id: activeRenewalSub.id }).update({
      end_date: expiredEndDate,
      grace_days: 5 // expired but within 5 grace days
    });

    // Run scheduler
    console.log('   Running renewal scheduler check...');
    await checkExpiringSubscriptions();

    // Verify grace started log and warning remote status
    const graceLog = await db('billing_logs')
      .where({ subscription_id: activeRenewalSub.id, action: 'grace_started' })
      .first();
    
    if (!graceLog) throw new Error('Grace started log entry not created');
    
    const graceLicense = await db('licenses').where({ id: activeRenewalSub.license_id }).first();
    if (graceLicense.remote_status !== 'warning') {
      throw new Error(`Expected remote_status 'warning', got '${graceLicense.remote_status}'`);
    }
    console.log('   ✓ Subscription entered orange warning mode. Remote status: warning');

    // Mock middleware request (should allow modifications since within grace period)
    let middlewareResponse = null;
    const reqGrace = { method: 'POST', path: '/api/projects' };
    const resGrace = {
      status: (code) => ({
        json: (val) => { middlewareResponse = { code, val }; }
      })
    };
    await verifyLicenseMiddleware(reqGrace, resGrace, () => { middlewareResponse = 'passed'; });
    if (middlewareResponse !== 'passed') {
      throw new Error('Middleware blocked write request during grace period');
    }
    console.log('   ✓ Write requests allowed during grace period');

    // Fast-forward past grace days (10 days ago)
    const lockoutEndDate = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await db('subscriptions').where({ id: activeRenewalSub.id }).update({
      end_date: lockoutEndDate,
      status: 'active' // reset back to active for trigger
    });

    // Run scheduler again
    await checkExpiringSubscriptions();

    const expiredSub = await db('subscriptions').where({ id: activeRenewalSub.id }).first();
    const expiredLicense = await db('licenses').where({ id: activeRenewalSub.license_id }).first();
    
    if (expiredSub.status !== 'expired' || expiredLicense.status !== 'expired') {
      throw new Error('Subscription/License not marked expired after grace period elapsed');
    }
    console.log('   ✓ Grace period elapsed. Subscription & License status marked "expired".');

    // Verify Read-Only Mode (should block write methods with 403)
    let blockResponse = null;
    const reqBlocked = { method: 'POST', path: '/api/projects' };
    const resBlocked = {
      status: (code) => ({
        json: (val) => { blockResponse = { code, val }; }
      })
    };
    await verifyLicenseMiddleware(reqBlocked, resBlocked, () => { blockResponse = 'passed'; });
    
    if (blockResponse === 'passed' || blockResponse.code !== 403) {
      throw new Error('Read-only block not enforced for expired subscription');
    }
    console.log(`   ✓ Read-only lockout enforced successfully! Block code: ${blockResponse.code}, msg: ${blockResponse.val.error}`);

    // -------------------------------------------------------------------------
    // 7. TEST REFUNDS
    // -------------------------------------------------------------------------
    console.log('\n🔹 8. Testing Refunds...');
    await payService.refundPayment(renewalPayment.id, 'Faulty purchase refund request');
    
    const refundedSub = await db('subscriptions').where({ id: renewalSub.id }).first();
    const refundedPayment = await db('payments').where({ id: renewalPayment.id }).first();
    const refundedLicense = await db('licenses').where({ id: refundedSub.license_id }).first();

    if (refundedPayment.status !== 'refunded') {
      throw new Error('Payment not in refunded status');
    }
    if (refundedSub.status !== 'cancelled') {
      throw new Error('Subscription not cancelled after refund');
    }
    if (refundedLicense.status !== 'suspended') {
      throw new Error('License not suspended after refund');
    }
    console.log('   ✓ Payment refunded. Subscription cancelled and License suspended.');

    // -------------------------------------------------------------------------
    // 8. AUDIT LOGS HISTORY
    // -------------------------------------------------------------------------
    console.log('\n🔹 9. Verifying Billing Logs (GxP Audit Trails)...');
    const logs = await db('billing_logs')
      .where({ customer_id: testCustomer.id })
      .orderBy('id', 'asc');

    console.log(`   Logs retrieved: ${logs.length}`);
    logs.forEach(l => {
      console.log(`     - [${l.action}] ${l.details}`);
    });
    
    if (logs.length < 5) {
      throw new Error('Expected at least 5 audit logs, got ' + logs.length);
    }
    console.log('   ✓ Complete immutable audit trail generated');

    // -------------------------------------------------------------------------
    // 9. BACKWARD COMPATIBILITY
    // -------------------------------------------------------------------------
    console.log('\n🔹 10. Testing Legacy Licenses Compatibility...');
    
    // Setup legacy license without custom customer or subscription
    const legacyKey = generateLicenseKey({
      license_type: 'single',
      activation_date: new Date().toISOString(),
      expiry_date: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      limits: {},
      features: {}
    }, secret);
    const legacySig = legacyKey.split('.')[1];

    const [legacyId] = await db('licenses').insert({
      license_key: legacyKey,
      license_type: 'single',
      status: 'active',
      activation_date: new Date(),
      expiry_date: new Date(Date.now() + 30 * 24 * 3600 * 1000), // active for 30 days
      signature: legacySig,
      license_id_str: 'LIC-LEGACY-01',
      customer_id: null,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');
    const legacyIdVal = typeof legacyId === 'object' ? (legacyId.id || Object.values(legacyId)[0]) : legacyId;

    let legacyResponse = null;
    const reqLegacy = { method: 'POST', path: '/api/projects' };
    const resLegacy = {
      status: (code) => ({
        json: (val) => { legacyResponse = { code, val }; }
      })
    };

    await verifyLicenseMiddleware(reqLegacy, resLegacy, () => { legacyResponse = 'passed'; });
    if (legacyResponse !== 'passed') {
      throw new Error('Legacy active license blocked by billing middleware checks');
    }
    console.log('   ✓ Legacy active licenses operate normally. Backward compatibility preserved!');

    // Clean legacy license
    await db('licenses').where({ id: legacyIdVal }).del();

    console.log('\n🎉 ALL PHASE 7 SUBSCRIPTION & BILLING TESTS PASSED SUCCESSFULLY!');

  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exit(1);
  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------------------
    console.log('\n🧹 Cleaning up test database records...');
    if (testCustomer) {
      // Delete logs, payments, invoices, subscriptions, license usage, license features, licenses, plans, customer
      const subs = await db('subscriptions').where({ customer_id: testCustomer.id }).select('id', 'license_id');
      const subIds = subs.map(s => s.id);
      const licIds = subs.map(s => s.license_id).filter(id => id !== null);

      await db('billing_logs').where({ customer_id: testCustomer.id }).del();
      
      if (subIds.length) {
        const invs = await db('invoices').whereIn('subscription_id', subIds).select('id');
        const invIds = invs.map(i => i.id);
        if (invIds.length) {
          await db('payments').whereIn('invoice_id', invIds).del();
          await db('invoices').whereIn('id', invIds).del();
        }
        await db('subscriptions').whereIn('id', subIds).del();
      }

      if (licIds.length) {
        await db('license_usage').whereIn('license_id', licIds).del();
        await db('license_features').whereIn('license_id', licIds).del();
        await db('license_logs').whereIn('license_id', licIds).del();
        await db('licenses').whereIn('id', licIds).del();
      }

      await db('customers').where({ id: testCustomer.id }).del();
    }
    if (testPlan) {
      await db('subscription_plans').where({ id: testPlan.id }).del();
    }

    console.log('🧹 Cleanup finished.');
    process.exit(0);
  }
}

runTests();
