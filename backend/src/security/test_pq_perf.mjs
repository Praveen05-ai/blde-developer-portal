/**
 * Performance Qualification Benchmarking Suite - Milestone 10 (.mjs)
 * BLDE EDC Clinical Research Platform - Phase 3 Compliance
 */

import assert from 'assert';
import db from '../db/connection.js';
import { writeAuditLog, verifyAuditTrail } from './audit_engine.js';

console.log('==============================================================================');
console.log('     BLDE EDC Clinical Platform - Database & Chaining Performance Benchmark   ');
WriteLog('==============================================================================\n');

function WriteLog(msg) {
  console.log(msg);
}

async function runPerformanceQualification() {
  const seededIds = [];
  try {
    // Proactive cleanup
    await db('audit_log').where({ record_id: 'PT-PQ-101' }).del();

    // 1. Sequentially write 100 records and benchmark average latency
    WriteLog('[PQ-BENCH-1] Measuring sequential write latency (100 audit entries)...');
    const writeStart = Date.now();
    for (let i = 0; i < 100; i++) {
      await writeAuditLog({
        projectId: 1,
        recordId: 'PT-PQ-101',
        instrumentId: 1,
        userId: 99,
        userName: 'perf.test@blde.ac.in',
        action: 'PERF_WRITE_TEST',
        fieldName: 'latency_index',
        newValue: i.toString()
      });
    }
    const writeTotal = Date.now() - writeStart;
    const avgWrite = writeTotal / 100;

    WriteLog(`   -> Total write time for 100 entries: ${writeTotal}ms`);
    WriteLog(`   -> Average latency per write transaction: ${avgWrite.toFixed(2)}ms`);

    // GxP assertion: sequential database write should average under 20ms under local conditions
    assert.ok(avgWrite < 20.0, 'Average transaction write latency must be under 20ms');
    WriteLog('   -> Pass: Average transaction write latency is within GxP boundaries.');

    // 2. Benchmark forensic ledger chain verification
    WriteLog('\n[PQ-BENCH-2] Measuring forensic audit chain verification latency...');
    const verifyStart = Date.now();
    const verification = await verifyAuditTrail();
    const verifyTotal = Date.now() - verifyStart;

    WriteLog(`   -> Total audit ledger verification time: ${verifyTotal}ms`);
    assert.strictEqual(verification.valid, true, 'Audit trail must be completely intact and valid');
    
    // GxP assertion: verification must be blistering fast
    assert.ok(verifyTotal < 15.0, 'Ledger verification must execute in under 15ms');
    WriteLog('   -> Pass: Audit ledger verification latency is within GxP boundaries.');

  } catch (err) {
    WriteLog(`\n[FAILED] Performance Benchmark validation faulted: ${err.message}`);
    process.exit(1);
  } finally {
    WriteLog('\n🧹 Cleaning up benchmarks records...');
    await db('audit_log').where({ record_id: 'PT-PQ-101' }).del();
    WriteLog('==============================================================================');
    WriteLog('🎉 PERFORMANCE QUALIFICATION STABILITY CHECKS PASSED!');
    WriteLog('==============================================================================');
    process.exit(0);
  }
}

runPerformanceQualification().catch(e => {
  console.error(e);
  process.exit(1);
});
