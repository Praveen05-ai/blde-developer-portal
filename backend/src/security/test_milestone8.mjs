/**
 * E2E Compliance Validation Suite - Milestone 8 (.mjs)
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import assert from 'assert';
import db from '../db/connection.js';
import { writeAuditLog, verifyAuditTrail, compileAuditCSV } from './audit_engine.js';

console.log('==============================================================================');
console.log('       BLDE EDC Clinical Platform - Milestone 8 Compliance Validation          ');
console.log('==============================================================================\n');

async function runMilestone8Tests() {
  const seededAuditIds = [];

  try {
    // Proactive cleanup of left-over records
    await db('audit_log').where({ record_id: 'PT-801' }).del();

    // ---------------------------------------------------------------------------
    // 1. Audit Trail Seeding & Verification
    // ---------------------------------------------------------------------------
    console.log('🧪 Test 1: Seeding standard clinical audit logs and verifying integrity...');
    
    const actions = [
      { action: 'CRF_CREATE', fieldName: 'record_id', newValue: 'PT-801' },
      { action: 'CRF_EDIT', fieldName: 'systolic_bp', oldValue: '120', newValue: '130' },
      { action: 'CRF_SIGN', fieldName: 'lock_signature', newValue: 'sig_abc_123' },
      { action: 'EXPORTS_EXEC', fieldName: 'format', newValue: 'CSV' }
    ];

    for (const item of actions) {
      await writeAuditLog({
        projectId: 1,
        recordId: 'PT-801',
        instrumentId: 1,
        userId: 9,
        userName: 'pi.test@blde.ac.in',
        action: item.action,
        fieldName: item.fieldName,
        oldValue: item.oldValue,
        newValue: item.newValue,
        ipAddress: '127.0.0.1'
      });
    }

    // Retrieve the inserted record IDs for cleanup/tampering simulation
    const insertedLogs = await db('audit_log').where({ record_id: 'PT-801' }).orderBy('id', 'asc');
    insertedLogs.forEach(log => seededAuditIds.push(log.id));

    // Verify initially that the audit trail is 100% valid
    const initialCheck = await verifyAuditTrail();
    assert.strictEqual(initialCheck.valid, true, 'Audit chain must be completely valid on start');
    console.log('   -> Pass: Clinical audit logs chained cleanly.');

    // ---------------------------------------------------------------------------
    // 2. Manual Record Tampering Simulation
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 2: Simulating manual database tampering (Record manipulation)...');
    
    // Forcibly alter the record data in the database, bypassing the audit engine
    const targetLogId = seededAuditIds[1]; // The CRF_EDIT log
    const originalLog = await db('audit_log').where({ id: targetLogId }).first();
    
    // Tamper with the new_value (from 130 to 999)
    await db('audit_log').where({ id: targetLogId }).update({
      new_value: '999'
    });

    // Verify that the chain is flagged as compromised
    const tamperedCheck = await verifyAuditTrail();
    assert.strictEqual(tamperedCheck.valid, false, 'Tampered log should be detected');
    assert.strictEqual(tamperedCheck.corruptedRecordId, targetLogId, 'Should identify exact corrupt record ID');
    assert.strictEqual(tamperedCheck.reason, 'RECORD_CONTENT_TAMPERED', 'Should indicate content tampering');
    console.log('   -> Pass: Manual content changes successfully detected.');

    // Restore the database back to original value
    await db('audit_log').where({ id: targetLogId }).update({
      new_value: originalLog.new_value
    });

    // ---------------------------------------------------------------------------
    // 3. Broken Hash Chain Links Detection
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 3: Simulating broken hash-chain links detection...');
    
    const downstreamLogId = seededAuditIds[2]; // The CRF_SIGN log
    const originalDownstream = await db('audit_log').where({ id: downstreamLogId }).first();

    // Tamper with the previous_hash (broken bridge)
    await db('audit_log').where({ id: downstreamLogId }).update({
      previous_hash: 'corrupt_hash_bridge'
    });

    const chainCheck = await verifyAuditTrail();
    assert.strictEqual(chainCheck.valid, false, 'Broken hash bridges must fail verification');
    assert.strictEqual(chainCheck.corruptedRecordId, downstreamLogId, 'Should identify exact corrupt ID');
    assert.strictEqual(chainCheck.reason, 'HASH_CHAIN_LINK_BROKEN', 'Should detect broken hash link');
    console.log('   -> Pass: Tampered previous hash links successfully detected.');

    // Restore the database
    await db('audit_log').where({ id: downstreamLogId }).update({
      previous_hash: originalDownstream.previous_hash
    });

    // ---------------------------------------------------------------------------
    // 4. Large Audit Ledger Stress Test
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 4: Running large ledger stress test (500 entries)...');
    
    const startTime = Date.now();
    
    // Seed 500 audit logs
    for (let i = 0; i < 500; i++) {
      await writeAuditLog({
        projectId: 1,
        recordId: 'PT-801',
        instrumentId: 1,
        userId: 9,
        userName: 'deo.stress@blde.ac.in',
        action: 'STRESS_TEST',
        fieldName: 'load',
        newValue: i.toString()
      });
    }

    const midTime = Date.now();
    const writeTime = midTime - startTime;

    // Run verification on the expanded ledger
    const stressCheck = await verifyAuditTrail();
    const verifyTime = Date.now() - midTime;

    assert.strictEqual(stressCheck.valid, true, 'Extended stress chain must remain 100% intact');
    console.log(`   -> Pass: Seeded 500 records in ${writeTime}ms; Verified all in ${verifyTime}ms.`);

    // ---------------------------------------------------------------------------
    // 5. Compliance Exporter Validation
    // ---------------------------------------------------------------------------
    console.log('\n🧪 Test 5: Verifying compliance exports formats (CSV/Structured data)...');
    
    const allLogs = await db('audit_log').where({ record_id: 'PT-801' }).orderBy('id', 'asc');
    const csvContent = compileAuditCSV(allLogs);
    
    assert.ok(csvContent.includes('Timestamp'), 'CSV must contain headers');
    assert.ok(csvContent.includes('deo.stress@blde.ac.in'), 'CSV must contain operator data');
    assert.ok(csvContent.includes('STRESS_TEST'), 'CSV must contain log actions');
    console.log('   -> Pass: CSV compliance formats generated correctly.');

  } catch (e) {
    console.error('\n❌ MILESTONE 8 VALIDATION FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    // Cleanup stress and seed logs
    console.log('\n🧹 Cleaning up test audit records...');
    await db('audit_log').where({ record_id: 'PT-801' }).del();
    
    console.log('==============================================================================');
    console.log('🎉 ALL MILESTONE 8 FORENSIC LEDGER & HASH CHAIN SIMULATIONS PASSED!');
    console.log('==============================================================================');
    process.exit(0);
  }
}

runMilestone8Tests().catch(e => {
  console.error(e);
  process.exit(1);
});
