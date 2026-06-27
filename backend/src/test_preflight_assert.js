import assert from 'assert';
import { env } from './config/env.js';
import { db } from './db/connection.js';

async function runTests() {
  console.log('==============================================================================');
  console.log('     BLDE EDC API preflight & Database Schema Self-Verification Suite         ');
  console.log('==============================================================================\n');

  // Test 1: Verify Environment Variable Configurations
  console.log('🧪 Test 1: Evaluating dynamic environment validation patterns...');
  assert.ok(env.jwt.secret, 'JWT Secret should be active and populated');
  assert.ok(env.uploads.maxSizeBytes > 0, 'Upload size constraint must be greater than zero');
  assert.ok(env.uploads.dir, 'Upload attachments path mapping must exist');
  console.log('   -> Pass: Environment validation rules verified.');

  // Test 2: Verify Database Schema Connectivity Dialect-Agnostic Raw Queries
  console.log('\n🧪 Test 2: Evaluating database raw connectivity queries (db.raw)...');
  try {
    const r = await db.raw('SELECT 1 as conn_check');
    assert.ok(r, 'Raw SELECT statement should return valid query results');
    console.log(`   -> Pass: ${env.db.client} socket connection verified.`);
  } catch (err) {
    console.error('   -> Fail: Database connectivity check failed:', err.message);
    process.exit(1);
  }

  // Test 3: Verify Core Tables Schema Existence
  console.log('\n🧪 Test 3: Verifying structural clinical databases and columns...');
  try {
    const hasUsers = await db.schema.hasTable('users');
    const hasProjects = await db.schema.hasTable('projects');
    const hasAuditLog = await db.schema.hasTable('audit_log');
    const hasDDE = await db.schema.hasTable('dde_records');
    
    assert.ok(hasUsers, 'Clinical users table must exist');
    assert.ok(hasProjects, 'Clinical projects repository must exist');
    assert.ok(hasAuditLog, 'Immutable GxP audit log table must exist');
    assert.ok(hasDDE, 'Double Data Entry discrepancies ledger must exist');
    console.log('   -> Pass: Core databases schemas verified.');
  } catch (err) {
    console.error('   -> Fail: Core schema validations failed:', err.message);
    process.exit(1);
  }

  // Test 4: Verify Audit Log Immutability Protection Rules (UPDATE blocker)
  if (env.databaseMode === 'pg') {
    console.log('\n🧪 Test 4: Evaluating GxP Audit Trail Immutability protection rules...');
    try {
      // Query rule names from pg_rules catalog
      const rules = await db.raw("SELECT rulename FROM pg_rules WHERE tablename = 'audit_log';");
      const ruleNames = rules.rows.map(r => r.rulename);
      
      assert.ok(ruleNames.includes('protect_audit_logs'), 'UPDATE block rule protect_audit_logs must be active');
      assert.ok(ruleNames.includes('lock_audit_logs'), 'DELETE block rule lock_audit_logs must be active');
      console.log('   -> Pass: PostgreSQL rewrite rules verified and active.');
    } catch (err) {
      console.error('   -> Fail: Audit trail rules checks failed:', err.message);
      process.exit(1);
    }
  }

  console.log('\n==============================================================================');
  console.log('🎉 ALL INTEGRITY SELF-VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('==============================================================================');
  process.exit(0);
}

runTests().catch(e => {
  console.error('Test execution crash:', e);
  process.exit(1);
});
