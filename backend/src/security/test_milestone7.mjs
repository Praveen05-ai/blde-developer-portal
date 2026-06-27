/**
 * E2E Compliance Validation Suite - Milestone 7 (.mjs)
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import assert from 'assert';
import bcrypt from 'bcryptjs';
import db from '../db/connection.js';
import { validatePasswordStrength, isPasswordExpired } from './rbac_middleware.js';
import { handleFailedLogin, checkAccountLockout, verifyOperatorReauth } from './session_guard.js';
import { signCRF, handleCRFModification, unlockCRF, CRF_STATUS } from './signature_engine.js';

console.log('==============================================================================');
console.log('       BLDE EDC Clinical Platform - Milestone 7 Compliance Validation          ');
console.log('==============================================================================\n');

async function runMilestone7Tests() {
  let testUserId = null;
  let testRecordId = null;
  let testPiId = null;

  try {
    // Proactive cleanup of left-over test records from previous runs
    await db('users').where({ email: 'deo.test@blde.ac.in' }).del();
    await db('users').where({ email: 'pi.test@blde.ac.in' }).del();
    await db('records').where({ record_id: 'PT-701' }).del();
    // ---------------------------------------------------------------------------
    // 1. Password Complexity Rules Validation
    // ---------------------------------------------------------------------------
    console.log('🧪 Test 1: Evaluating GxP password strength complexity rules...');
    assert.strictEqual(validatePasswordStrength('123456'), false, 'Should reject numeric password');
    assert.strictEqual(validatePasswordStrength('Password'), false, 'Should reject letters only');
    assert.strictEqual(validatePasswordStrength('Password12'), false, 'Should reject password without special chars');
    assert.strictEqual(validatePasswordStrength('P@ssw0rd99!'), true, 'Should approve complex password');
    console.log('   -> Pass: Complex password rules enforced.');

    // ---------------------------------------------------------------------------
    // 2. Account Lockout & Throttling Verification
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 2: Evaluating login attempts throttling and 15-minute lockouts...');
    
    // Seed a mock user for login testing
    const hashedPassword = await bcrypt.hash('P@ssw0rd99!', 10);
    const [insertedId] = await db('users').insert({
      name: 'DEO Test Operator',
      email: 'deo.test@blde.ac.in',
      password: hashedPassword,
      role: 'operator',
      active: true
    });
    testUserId = insertedId;

    let user = await db('users').where({ id: testUserId }).first();
    assert.strictEqual(user.failed_login_attempts, 0, 'Initial failures should be 0');

    // Simulate 5 failed login attempts
    for (let i = 1; i <= 5; i++) {
      await handleFailedLogin(user);
      user = await db('users').where({ id: testUserId }).first();
    }

    const lockoutStatus = await checkAccountLockout(user);
    assert.strictEqual(lockoutStatus.locked, true, 'User must be locked after 5 failed logins');
    assert.ok(lockoutStatus.reason.includes('temporarily locked'), 'Reason must indicate lockout');
    console.log('   -> Pass: User lockout and failed-login throttling works successfully.');

    // Reset lockout for subsequent testing
    await db('users').where({ id: testUserId }).update({
      failed_login_attempts: 0,
      lockout_until: null
    });

    // ---------------------------------------------------------------------------
    // 3. PI Re-Authentication Validation
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 3: Evaluating Part 11 operator re-authentication gates...');
    const piPassword = await bcrypt.hash('P@ssw0rd99!', 10);
    const [insertedPiId] = await db('users').insert({
      name: 'PI Test Investigator',
      email: 'pi.test@blde.ac.in',
      password: piPassword,
      role: 'pi',
      active: true
    });
    testPiId = insertedPiId;

    // Verify re-auth with invalid password fails
    try {
      await verifyOperatorReauth('pi.test@blde.ac.in', 'WrongPass123!');
      assert.fail('Should fail re-authentication on wrong password');
    } catch (err) {
      assert.strictEqual(err.message, 'REAUTH_INVALID_PASSWORD');
    }

    // Verify re-auth with correct credentials succeeds
    const authedUser = await verifyOperatorReauth('pi.test@blde.ac.in', 'P@ssw0rd99!');
    assert.strictEqual(authedUser.email, 'pi.test@blde.ac.in');
    console.log('   -> Pass: Part 11 re-authentication gate successfully enforced.');

    // ---------------------------------------------------------------------------
    // 4. Electronic Signature Attestation and locked state
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 4: Evaluating Electronic Signature attestation & locks...');
    
    // Seed a mock CRF record
    const [recId] = await db('records').insert({
      project_id: 1,
      instrument_id: 1,
      record_id: 'PT-701',
      data: JSON.stringify({ systolic_bp: 120, diastolic_bp: 80 }),
      status: 'incomplete',
      locked: false
    });
    testRecordId = recId;

    // Attempt PI sign-off
    const signResult = await signCRF(
      'pi.test@blde.ac.in',
      'P@ssw0rd99!',
      testRecordId,
      'Review and lock CRF data accuracy.'
    );

    assert.ok(signResult.lock_signature, 'Should return cryptographic signature hash');
    
    // Assert record is locked
    const lockedRecord = await db('records').where({ id: testRecordId }).first();
    assert.strictEqual(lockedRecord.locked, 1, 'Record should be locked in database');
    assert.strictEqual(lockedRecord.status, 'complete', 'Record status should be locked');
    assert.strictEqual(lockedRecord.locked_by, testPiId, 'Should link to the PI user');
    console.log('   -> Pass: E-Signature attestation successfully binds and locks CRF.');

    // ---------------------------------------------------------------------------
    // 5. Invalidation and Privilege Escalation Protections
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 5: Evaluating edit invalidation & privilege escalation checks...');
    
    // DEO operator attempts to unlock or sign
    try {
      await signCRF('deo.test@blde.ac.in', 'P@ssw0rd99!', testRecordId, 'DEO try to sign');
      assert.fail('Should block DEO from signing locked CRF');
    } catch (err) {
      assert.strictEqual(err.message, 'SIGN_INSUFFICIENT_PRIVILEGES', 'Should throw privilege warning');
    }

    // Attempting edit on locked CRF must be rejected
    try {
      await handleCRFModification(testRecordId, testUserId);
      assert.fail('Should block edits on locked records');
    } catch (err) {
      assert.strictEqual(err.message, 'CRF_WRITE_LOCKED');
    }

    // Unlock record formally using PI credentials
    await unlockCRF('pi.test@blde.ac.in', 'P@ssw0rd99!', testRecordId, 'Allow revision.');
    
    const unlockedRecord = await db('records').where({ id: testRecordId }).first();
    assert.strictEqual(unlockedRecord.locked, 0, 'Record must be unlocked');
    assert.strictEqual(unlockedRecord.lock_signature, null, 'Signature must be cleared');
    assert.strictEqual(unlockedRecord.status, CRF_STATUS.DRAFT, 'CRF state must reset to Draft');

    // Run subsequent edit to ensure it edits cleanly
    await handleCRFModification(testRecordId, testUserId);
    console.log('   -> Pass: Invalidation and privilege gates successfully defend locked datasets.');

  } catch (e) {
    console.error('\n❌ MILESTONE 7 VALIDATION FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    // Cleanup seed users and records
    if (testUserId) {
      await db('users').where({ id: testUserId }).del();
    }
    if (testPiId) {
      await db('users').where({ id: testPiId }).del();
    }
    if (testRecordId) {
      await db('records').where({ id: testRecordId }).del();
    }
    console.log('\n==============================================================================');
    console.log('🎉 ALL MILESTONE 7 COMPLIANCE & ACCESS SAFETY SIMULATIONS PASSED!');
    console.log('==============================================================================');
    process.exit(0);
  }
}

runMilestone7Tests().catch(e => {
  console.error(e);
  process.exit(1);
});
