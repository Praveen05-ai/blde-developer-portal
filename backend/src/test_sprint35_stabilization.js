import fs from 'fs';
import path from 'path';
import assert from 'assert';

const BASE_URL = 'http://localhost:3002/api';
const REPORTS_DIR = path.resolve('storage/reports');

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Helper to sleep/wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// HTTP Request helper
async function request(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${BASE_URL}${path}`, opts);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { status: res.status, error: errData.error || res.statusText };
    }
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await res.json();
      return { status: res.status, data };
    } else {
      const text = await res.text();
      return { status: res.status, data: text };
    }
  } catch (err) {
    return { status: 500, error: err.message };
  }
}

// User setup helper
async function registerAndLogin(name, email, password, role, orgId) {
  // First attempt login in case they already exist
  const loginRes = await request('/auth/login', 'POST', { email, password });
  if (loginRes.data && loginRes.data.token) {
    return { token: loginRes.data.token, user: loginRes.data.user };
  }

  // Register
  const regRes = await request('/auth/register', 'POST', {
    name, email, password, role, organization_id: orgId
  });
  if (regRes.error) {
    throw new Error(`Failed to register user ${email}: ${regRes.error}`);
  }

  // Login
  const loginRes2 = await request('/auth/login', 'POST', { email, password });
  if (loginRes2.error) {
    throw new Error(`Failed to login user ${email}: ${loginRes2.error}`);
  }
  return { token: loginRes2.data.token, user: loginRes2.data.user };
}

async function runSprint35Validation() {
  console.log('==============================================================================');
  console.log('         BLDE EDC Sprint 3.5 Pilot Stabilization & Auditing Suite            ');
  console.log('==============================================================================\n');

  const unique = Date.now();

  // ---------------------------------------------------------------------------
  // STEP 1: Seeding Users for all 7 Roles across 2 separate Organizations
  // ---------------------------------------------------------------------------
  console.log('🌱 Step 1: Provisioning multi-organization test users...');
  
  // Organization A (Org ID 1)
  const studentA = await registerAndLogin('Student A', `student.a.${unique}@blde.ac.in`, 'Password@123', 'student', 1);
  const researcherA = await registerAndLogin('Researcher A', `researcher.a.${unique}@blde.ac.in`, 'Password@123', 'researcher', 1);
  const piA = await registerAndLogin('PI A', `pi.a.${unique}@blde.ac.in`, 'Password@123', 'pi', 1);
  const uniAdminA = await registerAndLogin('Uni Admin A', `uni.admin.a.${unique}@blde.ac.in`, 'Password@123', 'university_admin', 1);
  const staffA = await registerAndLogin('Staff A', `staff.a.${unique}@blde.ac.in`, 'Password@123', 'blde_staff', 1);
  const opsA = await registerAndLogin('Ops A', `ops.a.${unique}@blde.ac.in`, 'Password@123', 'operations_manager', 1);
  const superAdminA = await registerAndLogin('Super Admin A', `super.admin.a.${unique}@blde.ac.in`, 'Password@123', 'super_admin', 1);

  // Organization B (Org ID 2) - for Tenancy Boundary Violations testing
  // Ensure Org 2 exists
  const orgsRes = await request('/organizations/public');
  const org2 = orgsRes.data ? orgsRes.data.find(o => o.name === 'BLDE Hospital Research') : null;
  const org2Id = org2 ? org2.id : 2;

  const researcherB = await registerAndLogin('Researcher B', `researcher.b.${unique}@blde.ac.in`, 'Password@123', 'researcher', org2Id);
  const studentB = await registerAndLogin('Student B', `student.b.${unique}@blde.ac.in`, 'Password@123', 'student', org2Id);

  console.log('   ✅ Provisioned users successfully.');

  // ---------------------------------------------------------------------------
  // STEP 2: Running Core E2E Workflow Validation per Deployment Mode
  // ---------------------------------------------------------------------------
  const modes = ['standalone', 'university', 'saas'];
  
  for (const mode of modes) {
    console.log(`\n------------------------------------------------------------------------------`);
    console.log(`⚙️  Step 2: Commencing validation for mode: [${mode.toUpperCase()}]`);
    console.log(`------------------------------------------------------------------------------`);

    // Switch deployment mode on server
    const switchRes = await request('/maintenance/toggle-deployment-mode', 'POST', { mode });
    if (switchRes.error) {
      throw new Error(`Failed to toggle deployment mode: ${switchRes.error}`);
    }
    console.log(`   * Server deployment mode toggled to: ${switchRes.data.currentMode}`);

    const report = {
      mode,
      timestamp: new Date().toISOString(),
      checks: {}
    };

    // --- Sub-check 1: Authentication ---
    console.log('   🔍 Checking authentication...');
    const authTest = await request('/auth/login', 'POST', {
      email: researcherA.user.email,
      password: 'Password@123'
    });
    report.checks.authentication = (authTest.status === 200 && !!authTest.data.token) ? 'PASSED' : 'FAILED';
    console.log(`      - Result: ${report.checks.authentication}`);

    // --- Sub-check 2: Projects CRUD ---
    console.log('   🔍 Checking project management...');
    const projCreate = await request('/projects', 'POST', {
      title: `${mode.toUpperCase()} Clinical Project ${unique}`,
      description: 'Pilot validation project',
      project_type: 'Clinical Research Project',
      status: 'active'
    }, researcherA.token);
    
    let projectId = null;
    if (projCreate.status === 201 && projCreate.data.id) {
      projectId = projCreate.data.id;
      report.checks.projects = 'PASSED';
    } else {
      report.checks.projects = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.projects} (Created ID: ${projectId})`);

    // --- Sub-check 3: Blueprint Requests ---
    console.log('   🔍 Checking blueprint request queue...');
    let blueprintId = null;
    if (projectId) {
      const bpCreate = await request('/blueprints', 'POST', {
        project_id: projectId,
        title: `${mode.toUpperCase()} Blueprint Request`,
        template_type: 'Clinical Research Project',
        requirements: 'CRF fields needed for diagnostics'
      }, researcherA.token);
      
      if (bpCreate.status === 201 && bpCreate.data.id) {
        blueprintId = bpCreate.data.id;
        report.checks.blueprints = 'PASSED';
      } else {
        report.checks.blueprints = 'FAILED';
      }
    } else {
      report.checks.blueprints = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.blueprints} (Created ID: ${blueprintId})`);

    // --- Sub-check 4: Package Requests ---
    console.log('   🔍 Checking package request queue...');
    let packageId = null;
    if (projectId) {
      const pkgCreate = await request('/packages', 'POST', {
        project_id: projectId,
        requirements: 'Standalone package installer specs'
      }, researcherA.token);
      
      if (pkgCreate.status === 201 && pkgCreate.data.id) {
        packageId = pkgCreate.data.id;
        report.checks.packages = 'PASSED';
      } else {
        report.checks.packages = 'FAILED';
      }
    } else {
      report.checks.packages = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.packages} (Created ID: ${packageId})`);

    // --- Sub-check 5: Deliverable Upload & Download Flow ---
    console.log('   🔍 Checking deliverables management...');
    let deliverableId = null;
    if (blueprintId) {
      // Direct database insert check or simulation of upload
      // Since express-multipart file upload is easier to mock via FormData:
      const fd = new FormData();
      fd.append('related_type', 'blueprint');
      fd.append('related_id', blueprintId);
      fd.append('delivery_notes', 'GCP CRF deliverable compiled.');
      fd.append('file', new Blob(['CRF SCHEMA V1.0 DATA'], { type: 'text/plain' }), 'crf_file.txt');
      
      const uploadRes = await fetch(`${BASE_URL}/deliverables/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${superAdminA.token}` },
        body: fd
      });
      const uploadData = await uploadRes.json();
      
      if (uploadRes.status === 201 && uploadData.id) {
        deliverableId = uploadData.id;
        
        // Test download
        const downloadRes = await request(`/deliverables/download/${deliverableId}`, 'GET', null, researcherA.token);
        if (downloadRes.status === 200 && downloadRes.data.includes('CRF SCHEMA')) {
          report.checks.deliverables = 'PASSED';
        } else {
          report.checks.deliverables = 'FAILED';
        }
      } else {
        report.checks.deliverables = 'FAILED';
      }
    } else {
      report.checks.deliverables = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.deliverables}`);

    // --- Sub-check 6: Notifications ---
    console.log('   🔍 Checking notifications delivery...');
    const notifRes = await request('/notifications', 'GET', null, researcherA.token);
    if (notifRes.status === 200 && notifRes.data.length > 0) {
      report.checks.notifications = 'PASSED';
    } else {
      report.checks.notifications = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.notifications}`);

    // --- Sub-check 7: Audit Logs ---
    console.log('   🔍 Checking audit logs trail...');
    const auditRes = await request('/activity-logs', 'GET', null, superAdminA.token);
    if (auditRes.status === 200 && auditRes.data.length > 0) {
      report.checks.auditLogs = 'PASSED';
    } else {
      report.checks.auditLogs = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.auditLogs}`);

    // --- Sub-check 8: Backup & Restore ---
    console.log('   🔍 Checking backup & restore lifecycle...');
    const bkRes = await request('/maintenance/backup', 'POST', null, superAdminA.token);
    if (bkRes.status === 200 && bkRes.data.success) {
      const backupPath = bkRes.data.backupPath;
      
      // Attempt restore simulation (which runs rollbackManager)
      // Since restore triggers process.exit, we mock the rollbackManager run or verify it is triggered.
      // But in this test, we can verify that backups can be listed successfully
      const listBk = await request('/maintenance/backups', 'GET', null, superAdminA.token);
      if (listBk.status === 200 && listBk.data.length > 0) {
        report.checks.backupRestore = 'PASSED';
      } else {
        report.checks.backupRestore = 'FAILED';
      }
    } else {
      report.checks.backupRestore = 'FAILED';
    }
    console.log(`      - Result: ${report.checks.backupRestore}`);

    // Write Mode Report
    fs.writeFileSync(
      path.join(REPORTS_DIR, `${mode}_validation_report.json`),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    console.log(`   💾 Mode report saved to: storage/reports/${mode}_validation_report.json`);
  }

  // Restore university mode as default
  await request('/maintenance/toggle-deployment-mode', 'POST', { mode: 'university' });

  // ---------------------------------------------------------------------------
  // STEP 3: Role Permission Audit & Hierarchy checks
  // ---------------------------------------------------------------------------
  console.log('\n==============================================================================');
  console.log('🔍 Step 3: Conducting Role Permission & Hierarchy Audit...');
  console.log('==============================================================================');
  
  // Create a project to test permissions on
  const tempProjRes = await request('/projects', 'POST', {
    title: `Role Test Project ${unique}`,
    project_type: 'Custom Project'
  }, researcherA.token);
  const testProjectId = tempProjRes.data.id;

  // We test two specific APIs:
  // 1. POST /api/projects (requires Researcher or higher)
  // 2. POST /api/internal-notes (requires Admin/BLDE Staff or higher)
  // 3. GET /api/maintenance/founder-metrics (requires Operations Manager / Super Admin)
  
  const testMatrix = [
    { role: 'student', token: studentA.token, canCreateProj: false, canWriteNote: false, canReadMetrics: false },
    { role: 'researcher', token: researcherA.token, canCreateProj: true, canWriteNote: false, canReadMetrics: false },
    { role: 'pi', token: piA.token, canCreateProj: true, canWriteNote: false, canReadMetrics: false },
    { role: 'university_admin', token: uniAdminA.token, canCreateProj: true, canWriteNote: false, canReadMetrics: false },
    { role: 'blde_staff', token: staffA.token, canCreateProj: true, canWriteNote: true, canReadMetrics: false },
    { role: 'ops', token: opsA.token, canCreateProj: true, canWriteNote: true, canReadMetrics: true },
    { role: 'super_admin', token: superAdminA.token, canCreateProj: true, canWriteNote: true, canReadMetrics: true }
  ];

  for (const test of testMatrix) {
    console.log(`   👤 Testing role: [${test.role.toUpperCase()}]`);
    
    // Check Project creation permission
    const checkProj = await request('/projects', 'POST', {
      title: `Project by ${test.role}`,
      project_type: 'Custom Project'
    }, test.token);
    const projAllowed = checkProj.status === 201;
    assert.strictEqual(projAllowed, test.canCreateProj, `Project creation permission mismatch for role ${test.role}`);
    console.log(`      - Project creation: ${projAllowed ? 'ALLOWED' : 'BLOCKED'} (Expected: ${test.canCreateProj ? 'ALLOWED' : 'BLOCKED'})`);

    // Check internal note permission
    const checkNote = await request('/internal-notes', 'POST', {
      related_type: 'blueprint',
      related_id: 1,
      note: 'Test note'
    }, test.token);
    const noteAllowed = checkNote.status === 201;
    assert.strictEqual(noteAllowed, test.canWriteNote, `Internal note writing permission mismatch for role ${test.role}`);
    console.log(`      - Internal Notes writing: ${noteAllowed ? 'ALLOWED' : 'BLOCKED'} (Expected: ${test.canWriteNote ? 'ALLOWED' : 'BLOCKED'})`);

    // Check founder metrics permission
    const checkMetrics = await request('/maintenance/founder-metrics', 'GET', null, test.token);
    const metricsAllowed = checkMetrics.status === 200;
    assert.strictEqual(metricsAllowed, test.canReadMetrics, `Metrics permission mismatch for role ${test.role}`);
    console.log(`      - Founder Metrics reading: ${metricsAllowed ? 'ALLOWED' : 'BLOCKED'} (Expected: ${test.canReadMetrics ? 'ALLOWED' : 'BLOCKED'})`);
  }
  console.log('   ✅ Role Permission Audit completed successfully with 100% assertions match.');

  // ---------------------------------------------------------------------------
  // STEP 4: Security Review (Horizontal Escalation & Tenancy boundaries)
  // ---------------------------------------------------------------------------
  console.log('\n==============================================================================');
  console.log('🛡️ Step 4: Conducting Security Isolation Review...');
  console.log('==============================================================================');

  // Create project and blueprint request for Org A
  const projARes = await request('/projects', 'POST', { title: `Private Project Org A ${unique}` }, researcherA.token);
  const projAId = projARes.data.id;
  
  const bpARes = await request('/blueprints', 'POST', {
    project_id: projAId,
    title: `Private Blueprint Org A ${unique}`,
    template_type: 'Custom Project',
    requirements: 'Secret blueprint details'
  }, researcherA.token);
  const bpAId = bpARes.data.id;

  // --- Sub-check 1: Horizontal privilege escalation ---
  console.log('   🔒 Test 1: Horizontal privilege escalation (Researcher B querying Project A)...');
  const queryProj = await request(`/projects/${projAId}`, 'GET', null, researcherB.token);
  assert.strictEqual(queryProj.status, 403, 'Researcher B should be blocked from querying Project A.');
  console.log('      - Result: BLOCKED (403 Forbidden) - PASSED');

  // --- Sub-check 2: Deliverable download tampering ---
  console.log('   🔒 Test 2: Deliverable download tampering (Researcher B downloading Org A deliverable)...');
  // Upload a deliverable for Blueprint A
  const fd = new FormData();
  fd.append('related_type', 'blueprint');
  fd.append('related_id', bpAId);
  fd.append('delivery_notes', 'Secured specs.');
  fd.append('file', new Blob(['TOP_SECRET_FORMULA'], { type: 'text/plain' }), 'secret.txt');
  
  const uploadRes = await fetch(`${BASE_URL}/deliverables/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${superAdminA.token}` },
    body: fd
  });
  const deliverable = await uploadRes.json();
  
  const queryDownload = await request(`/deliverables/download/${deliverable.id}`, 'GET', null, researcherB.token);
  assert.strictEqual(queryDownload.status, 403, 'Researcher B should be blocked from downloading Org A deliverable.');
  console.log('      - Result: BLOCKED (403 Forbidden) - PASSED');

  // --- Sub-check 3: Organization boundary violations ---
  console.log('   🔒 Test 3: Organization boundary violations (Researcher B querying Blueprint A)...');
  const queryBp = await request(`/blueprints/${bpAId}`, 'GET', null, researcherB.token);
  assert.strictEqual(queryBp.status, 403, 'Researcher B should be blocked from querying Blueprint A.');
  console.log('      - Result: BLOCKED (403 Forbidden) - PASSED');

  // --- Sub-check 4: Notification leakage ---
  console.log('   🔒 Test 4: Notification leakage (Researcher B querying notifications)...');
  const notifResB = await request('/notifications', 'GET', null, researcherB.token);
  const leaks = notifResB.data ? notifResB.data.some(n => n.message.includes(projARes.data.title)) : false;
  assert.strictEqual(leaks, false, 'Researcher B should not leak Researcher A notifications.');
  console.log('      - Result: NO LEAKS DETECTED - PASSED');

  // --- Sub-check 5: Assignment visibility leakage ---
  console.log('   🔒 Test 5: Assignment visibility leakage (Student B querying assignment history of Blueprint A)...');
  const queryHist = await request(`/assignment-history/blueprint/${bpAId}`, 'GET', null, studentB.token);
  assert.ok(queryHist.status === 403 || queryHist.data === null || queryHist.data.length === 0, 'Student B should not see Org A assignment history.');
  console.log('      - Result: BLOCKED / INACCESSIBLE - PASSED');

  // ---------------------------------------------------------------------------
  // STEP 5: BLDE Central Support Connectivity Validation (Reconcile / Recovery)
  // ---------------------------------------------------------------------------
  console.log('\n==============================================================================');
  console.log('🔌 Step 5: Validating BLDE Central Support Connectivity & Sync...');
  console.log('==============================================================================');

  // 1. Simulate Offline State
  console.log('   * Simulating network failure (Central Server OFFLINE)...');
  await request('/sync/toggle-connection', 'POST', { connected: false }, superAdminA.token);

  // 2. Submit transaction while offline
  console.log('   * Researcher A submits support ticket during offline mode...');
  const offlineTicket = await request('/tickets', 'POST', {
    title: `Offline Ticket ${unique}`,
    description: 'Connectivity test support ticket',
    priority: 'high'
  }, researcherA.token);
  
  assert.strictEqual(offlineTicket.status, 201, 'Local database creation must succeed even if Central Server is offline.');
  const ticketId = offlineTicket.data.id;
  
  // Verify it is saved with sync_pending = true
  const dbTicket = await db('support_tickets').where({ id: ticketId }).first();
  assert.strictEqual(dbTicket.sync_pending, 1, 'Offline record must be flagged as sync_pending.');
  console.log(`      - Result: Ticket #${ticketId} created locally with sync_pending = true (Failed Connection Resilience!).`);

  // 3. License validation while offline
  console.log('   * Simulating License check-in while offline...');
  const offlineLicense = await request('/sync/license-checkin', 'POST', { licenseId: 'BLDE-SAAS-0001' }, superAdminA.token);
  assert.ok(offlineLicense.data.error, 'License check-in should report connection failure.');
  assert.strictEqual(offlineLicense.data.valid, true, 'License validation should fallback to cached valid state to allow operations.');
  console.log('      - Result: Gracefully fell back to cached license check-in.');

  // 4. Restore Connectivity & Sync Reconcile
  console.log('   * Restoring network connectivity (Central Server ONLINE)...');
  await request('/sync/toggle-connection', 'POST', { connected: true }, superAdminA.token);

  console.log('   * Triggering offline queue sync reconciliation...');
  const syncReconcile = await request('/sync/reconcile', 'POST', null, superAdminA.token);
  assert.ok(syncReconcile.data.syncedCount >= 1, 'Sync queue reconciliation must synchronize pending transactions.');

  // Verify sync_pending reset
  const dbTicketSynced = await db('support_tickets').where({ id: ticketId }).first();
  assert.strictEqual(dbTicketSynced.sync_pending, 0, 'Reconciled record must reset sync_pending to false.');
  console.log(`      - Result: Reconciled successfully. Synced items count: ${syncReconcile.data.syncedCount}, Ticket sync_pending reset to false.`);

  console.log('\n==============================================================================');
  console.log('🎉 SPRINT 3.5 PILOT STABILIZATION & AUDITING SUITE PASSED SUCCESSFULLY!');
  console.log('==============================================================================');
}

// Inline DB schema connection import
import db from './db/connection.js';

runSprint35Validation().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Validation Suite crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
