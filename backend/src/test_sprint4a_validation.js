import fs from 'fs';
import path from 'path';
import assert from 'assert';
import db from './db/connection.js';
import { validateFileSignature } from './utils/fileValidator.js';

const BASE_URL = 'http://localhost:3002/api';

// Simple API request helper using node-fetch (built-in in node 18+)
async function request(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, opts);
    const duration = Date.now() - start;
    const contentType = res.headers.get('content-type');
    let data = null;
    if (contentType && contentType.includes('application/json')) {
      data = await res.json().catch(() => ({}));
    } else {
      data = await res.text();
    }
    return { status: res.status, data, duration };
  } catch (err) {
    return { status: 500, error: err.message, duration: Date.now() - start };
  }
}

// Helper to register & login users
async function getOrRegisterUser(name, email, password, role, orgId) {
  const loginRes = await request('/auth/login', 'POST', { email, password });
  if (loginRes.data && loginRes.data.token) {
    return { token: loginRes.data.token, user: loginRes.data.user };
  }
  const regRes = await request('/auth/register', 'POST', {
    name, email, password, role, organization_id: orgId
  });
  if (regRes.status !== 201) {
    console.error(`Register failed for ${email}:`, regRes);
  }
  if (regRes.error) {
    throw new Error(`Failed to register user ${email}: ${regRes.error}`);
  }
  const loginRes2 = await request('/auth/login', 'POST', { email, password });
  if (loginRes2.status !== 200) {
    console.error(`Login failed for ${email}:`, loginRes2);
  }
  if (loginRes2.error) {
    throw new Error(`Failed to login user ${email}: ${loginRes2.error}`);
  }
  return { token: loginRes2.data ? loginRes2.data.token : null, user: loginRes2.data ? loginRes2.data.user : null };
}

async function runValidation() {
  console.log('==============================================================================');
  console.log('            BLDE EDC Platform Sprint 4A Compliance & E2E Validation           ');
  console.log('==============================================================================\n');

  const results = [];
  const unique = Date.now();

  const addResult = (testName, pass, details = '') => {
    results.push({ name: testName, status: pass ? 'PASS' : 'FAIL', details });
    console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] - ${testName} ${details ? '(' + details + ')' : ''}`);
  };

  // --- Test 1: Database Migration Success & Index Audit ---
  try {
    console.log('📂 Auditing database performance indexes and schemas...');
    
    // Check columns
    const columnsDeliv = await db('deliverables').columnInfo();
    const columnsFeedback = await db('pilot_feedback').columnInfo();

    const hasMime = 'mime_type' in columnsDeliv;
    const hasStatus = 'status' in columnsFeedback;

    assert.ok(hasMime, 'deliverables.mime_type column must exist');
    assert.ok(hasStatus, 'pilot_feedback.status column must exist');
    
    // Check indexes
    let indexes = [];
    const rows = await db.raw("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    indexes = rows.rows.map(r => r.indexname);

    const expectedIndexes = [
      'idx_users_org_role',
      'idx_projects_org_deleted',
      'idx_blueprints_org_status',
      'idx_blueprints_submitted_by',
      'idx_blueprints_staff_id',
      'idx_packages_org_status',
      'idx_packages_requested_by',
      'idx_packages_staff_id',
      'idx_deliverables_related',
      'idx_notifications_user_read',
      'idx_activity_logs_org_date'
    ];

    const missingIndexes = expectedIndexes.filter(idx => !indexes.includes(idx));
    
    if (missingIndexes.length === 0) {
      addResult('Database Index & Schema Check', true, 'All performance indexes and columns successfully verified');
    } else {
      addResult('Database Index & Schema Check', false, `Missing indexes: ${missingIndexes.join(', ')}`);
    }
  } catch (err) {
    addResult('Database Index & Schema Check', false, err.message);
  }

  // --- Test 2: File Magic-Number Signature Check ---
  try {
    console.log('\n🔍 Testing binary file signature verification algorithm...');
    
    // 1. PDF signature checks
    const validPdfBuffer = Buffer.from('255044460a312e342070646620636f6e74656e7473', 'hex'); // %PDF\n1.4 ...
    const invalidPdfBuffer = Buffer.from('4d5a90000300000004000000ffff0000b800000000', 'hex'); // MZ (EXE) header
    
    const check1 = validateFileSignature(validPdfBuffer, 'report.pdf');
    const check2 = validateFileSignature(invalidPdfBuffer, 'report.pdf');
    
    assert.strictEqual(check1.valid, true, 'Valid PDF buffer should be approved');
    assert.strictEqual(check1.mime, 'application/pdf');
    assert.strictEqual(check2.valid, false, 'EXE header renamed to .pdf should be rejected');

    // 2. PNG check
    const validPngBuffer = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex'); // \x89PNG...
    const checkPng = validateFileSignature(validPngBuffer, 'image.png');
    assert.strictEqual(checkPng.valid, true, 'Valid PNG buffer should be approved');
    assert.strictEqual(checkPng.mime, 'image/png');

    // 3. Text character sequences
    const textBuffer = Buffer.from('Hello, this is standard readable plain text contents for research.');
    const checkText = validateFileSignature(textBuffer, 'notes.txt');
    assert.strictEqual(checkText.valid, true, 'Plain text file signature should be approved');
    assert.strictEqual(checkText.mime, 'text/plain');

    addResult('Binary Signature Check Algorithm', true, 'Magic numbers parsed and verified correctly');
  } catch (err) {
    addResult('Binary Signature Check Algorithm', false, err.message);
  }

  // Provision accounts for remaining E2E tests
  let studentToken, staffToken, opsToken;
  let studentUser, staffUser, opsUser;
  try {
    const studentInfo = await getOrRegisterUser('Researcher S4A', `student.s4a.${unique}@blde.ac.in`, 'Password@123', 'researcher', 1);
    studentToken = studentInfo.token;
    studentUser = studentInfo.user;

    const staffInfo = await getOrRegisterUser('Staff S4A', `staff.s4a.${unique}@blde.ac.in`, 'Password@123', 'blde_staff', 1);
    staffToken = staffInfo.token;
    staffUser = staffInfo.user;

    const opsInfo = await getOrRegisterUser('Ops Manager S4A', `ops.s4a.${unique}@blde.ac.in`, 'Password@123', 'operations_manager', 1);
    opsToken = opsInfo.token;
    opsUser = opsInfo.user;

    console.log('Tokens provisioned:', {
      studentToken: studentToken ? studentToken.slice(0, 15) + '...' : null,
      staffToken: staffToken ? staffToken.slice(0, 15) + '...' : null,
      opsToken: opsToken ? opsToken.slice(0, 15) + '...' : null
    });
  } catch (err) {
    console.error('❌ Failed to provision test users. Cannot run full API suite.', err.message);
    process.exit(1);
  }

  // --- Test 3: API Security Hardening (Magic Number Enforcement) ---
  try {
    console.log('\n📤 Testing deliverable uploads with binary enforcement via API...');
    
    // Create a dummy project & blueprint request to test uploads against
    const projRes = await request('/projects', 'POST', {
      title: `E2E hardener Study - ${unique}`,
      description: `E2E hardener description`,
      department: 'General',
      guide_name: 'Dr. Hardener',
      project_type: 'Clinical Research Project',
      status: 'active'
    }, studentToken);
    const projectId = projRes.data.id;

    const bpRes = await request('/blueprints', 'POST', {
      project_id: projectId,
      title: `CRF Blueprint - ${unique}`,
      template_type: 'Clinical Research Project',
      requirements: 'CRF mapping specifications',
      status: 'submitted'
    }, studentToken);
    const bpId = bpRes.data.id;

    // A. Reject bad signature
    const fdBad = new FormData();
    fdBad.append('related_type', 'blueprint');
    fdBad.append('related_id', bpId);
    fdBad.append('category', 'Project Blueprint');
    fdBad.append('delivery_notes', 'Payload renamed as PDF');
    // Renamed script file (EXE/bad bytes)
    fdBad.append('file', new Blob([Buffer.from('4d5a90000300000004000000', 'hex')], { type: 'application/pdf' }), 'malicious_exec.pdf');

    const resBad = await fetch(`${BASE_URL}/deliverables/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${staffToken}` },
      body: fdBad
    });
    const badData = await resBad.json().catch(() => ({}));

    assert.strictEqual(resBad.status, 400, 'Renamed executable should yield HTTP 400 Bad Request');
    assert.ok(badData.error.includes('signature'), 'Error message should detail file signature failure');

    // B. Approve valid signature
    const fdGood = new FormData();
    fdGood.append('related_type', 'blueprint');
    fdGood.append('related_id', bpId);
    fdGood.append('category', 'Project Blueprint');
    fdGood.append('delivery_notes', 'Approved PDF CRF document');
    fdGood.append('file', new Blob(['%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<...'], { type: 'application/pdf' }), 'valid_schema.pdf');

    const resGood = await fetch(`${BASE_URL}/deliverables/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${staffToken}` },
      body: fdGood
    });
    const goodData = await resGood.json().catch(() => ({}));

    assert.strictEqual(resGood.status, 201, 'Valid PDF signature should be successfully uploaded');
    assert.strictEqual(goodData.mime_type, 'application/pdf', 'Uploaded deliverable should have MIME type set to application/pdf');

    // Verify it is recorded in database
    const dbDeliverable = await db('deliverables').where({ id: goodData.id }).first();
    assert.strictEqual(dbDeliverable.mime_type, 'application/pdf');

    addResult('MIME & Binary Validation Enforcement', true, 'Malicious signatures rejected; valid files uploaded and typed');
  } catch (err) {
    addResult('MIME & Binary Validation Enforcement', false, err.message);
  }

  // --- Test 4: Rate Limiting Enforcement ---
  try {
    console.log('\n⏱️ Testing API rate limiting limits (Login Endpoint)...');

    // Default max logins is 10 (configured in .env).
    // If we make 15 requests, we should receive at least one HTTP 429 Too Many Requests response.
    let hit429 = false;
    let limitMessage = '';

    for (let i = 0; i < 15; i++) {
      const res = await request('/auth/login', 'POST', {
        email: `notexist.${i}@blde.ac.in`,
        password: 'Password@123'
      });
      if (res.status === 429) {
        hit429 = true;
        limitMessage = res.data.error || 'Too many login attempts';
        break;
      }
    }

    if (hit429) {
      addResult('API Rate Limiting Enforcement', true, `HTTP 429 received successfully: "${limitMessage}"`);
    } else {
      addResult('API Rate Limiting Enforcement', false, 'Failed to trigger HTTP 429 on login flood');
    }
  } catch (err) {
    addResult('API Rate Limiting Enforcement', false, err.message);
  }

  // --- Test 5: Pilot Feedback Submission & Screenshot Upload ---
  try {
    console.log('\n💬 Testing Pilot Feedback submissions...');
    
    // Post feedback with screenshot
    const fdFeed = new FormData();
    fdFeed.append('category', 'Bug');
    fdFeed.append('severity', 'High');
    fdFeed.append('workflow_stage', 'Blueprint Request');
    fdFeed.append('description', 'Visual gap in mobile sidebar layout');
    fdFeed.append('screenshot', new Blob(['PNG_MOCK_BYTES'], { type: 'image/png' }), 'ui_gap.png');

    const resFeed = await fetch(`${BASE_URL}/feedback`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` },
      body: fdFeed
    });
    const feedData = await resFeed.json().catch(() => ({}));
    assert.strictEqual(resFeed.status, 201, 'Feedback record should be created');
    assert.strictEqual(feedData.category, 'Bug');
    assert.ok(feedData.screenshot_path, 'Screenshot path should be recorded');

    // Verify screenshot file exists on disk
    const rootPath = fs.existsSync('storage/uploads') ? path.resolve('storage/uploads') : path.resolve('../storage/uploads');
    const cleanFilename = feedData.screenshot_path.replace(/^\/uploads\//, '');
    const absoluteFilePath = path.join(rootPath, cleanFilename);
    assert.ok(fs.existsSync(absoluteFilePath), 'Screenshot file must be written to disk');

    // Fetch user feedback
    const myFeed = await request('/feedback/my', 'GET', null, studentToken);
    assert.strictEqual(myFeed.status, 200);
    assert.ok(myFeed.data.length >= 1, 'My feedback list must return the submitted record');
    assert.strictEqual(myFeed.data[0].id, feedData.id);

    // Review lists (Staff only)
    const revFeed = await request('/feedback', 'GET', null, staffToken);
    assert.strictEqual(revFeed.status, 200);
    assert.ok(revFeed.data.length >= 1, 'Staff must see feedback reviews');

    // Non-staff forbidden check
    const revFeedBad = await request('/feedback', 'GET', null, studentToken);
    assert.strictEqual(revFeedBad.status, 403, 'Non-staff feedback reviews must be forbidden');

    addResult('Feedback Portal Submission & Screenshots', true, 'Submissions, screenshot uploads, and scoped histories verified');
  } catch (err) {
    addResult('Feedback Portal Submission & Screenshots', false, err.message);
  }

  // --- Test 6: Feedback Status Update & Audit Log ---
  try {
    console.log('\n⚙️ Testing staff feedback review status transitions...');
    
    // Get latest feedback
    const latestFeed = await db('pilot_feedback').orderBy('created_at', 'desc').first();
    assert.ok(latestFeed, 'No feedback found to update status');

    // Transition status to in_progress
    const updateRes = await request(`/feedback/${latestFeed.id}`, 'PUT', { status: 'in_progress' }, staffToken);
    assert.strictEqual(updateRes.status, 200, 'Status update should succeed');
    
    const dbFeedback = await db('pilot_feedback').where({ id: latestFeed.id }).first();
    assert.strictEqual(dbFeedback.status, 'in_progress', 'Feedback status in database should be updated');

    // Verify Audit Log is created
    const log = await db('activity_logs')
      .where({ entity_type: 'feedback', entity_id: latestFeed.id, action: 'status_change' })
      .first();
    assert.ok(log, 'Status update must log activity record');
    assert.strictEqual(JSON.parse(log.metadata_json).to, 'in_progress');

    addResult('Feedback Status Workflow & Audit Logs', true, 'Transitions and activity logs validated');
  } catch (err) {
    addResult('Feedback Status Workflow & Audit Logs', false, err.message);
  }

  // --- Test 7: Deliverable Receipt Confirmation Workflow ---
  try {
    console.log('\n📦 Testing Deliverable Receipt ratings & comments workflow...');

    // Let's find a blueprint request in 'ready_for_delivery' or 'delivered' status, or create a quick dummy one.
    const projRes = await request('/projects', 'POST', {
      title: `E2E Receipt Study - ${unique}`,
      description: `E2E receipt description`,
      department: 'Pediatrics',
      guide_name: 'Dr. Receiver',
      project_type: 'Clinical Research Project',
      status: 'active'
    }, studentToken);
    const projectId = projRes.data.id;

    const bpRes = await request('/blueprints', 'POST', {
      project_id: projectId,
      title: `CRF Blueprint - ${unique}`,
      template_type: 'Clinical Research Project',
      requirements: 'CRF mapping specifications',
      status: 'submitted'
    }, studentToken);
    const bpId = bpRes.data.id;

    // Upload deliverable to push blueprint to ready_for_delivery
    const fdGood = new FormData();
    fdGood.append('related_type', 'blueprint');
    fdGood.append('related_id', bpId);
    fdGood.append('category', 'Project Blueprint');
    fdGood.append('delivery_notes', 'Approved PDF CRF document');
    fdGood.append('file', new Blob(['%PDF-1.4\n%âã'], { type: 'application/pdf' }), 'valid_doc.pdf');

    const resGood = await fetch(`${BASE_URL}/deliverables/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${staffToken}` },
      body: fdGood
    });
    assert.strictEqual(resGood.status, 201);

    // Verify Blueprint Request is in 'ready_for_delivery' status
    const bpBefore = await db('blueprint_requests').where({ id: bpId }).first();
    assert.strictEqual(bpBefore.status, 'ready_for_delivery');

    // Confirm receipt with Rating & Comments
    const receiveRes = await request(`/blueprints/${bpId}/receive`, 'POST', {
      rating: 5,
      useful: true,
      feedback_text: 'Excellent work. Meets clinical requirements.'
    }, studentToken);

    assert.strictEqual(receiveRes.status, 200, 'Receipt confirmation request should succeed');

    const bpAfter = await db('blueprint_requests').where({ id: bpId }).first();
    assert.strictEqual(bpAfter.status, 'delivered', 'Blueprint request status should transition to delivered');
    assert.strictEqual(bpAfter.marked_as_received, 1, 'marked_as_received should be true/1');
    assert.strictEqual(bpAfter.rating, 5, 'Rating should be saved');
    assert.strictEqual(bpAfter.useful, 1, 'Useful should be saved as true');
    assert.strictEqual(bpAfter.feedback_text, 'Excellent work. Meets clinical requirements.', 'Feedback text should be saved');

    addResult('Deliverable Receipt ratings & comments workflow', true, 'Receipt confirmation, ratings, and status transition verified');
  } catch (err) {
    addResult('Deliverable Receipt ratings & comments workflow', false, err.message);
  }

  // --- Test 8: Founder Acceptance KPIs Dashboard Metrics ---
  try {
    console.log('\n📊 Testing Founder Acceptance Dashboard Metrics API...');

    const metricsRes = await request('/metrics/dashboard', 'GET', null, opsToken);
    if (metricsRes.status !== 200) {
      console.log('Metrics error response:', metricsRes);
    }
    assert.strictEqual(metricsRes.status, 200, 'Dashboard metrics fetch should succeed');
    const data = metricsRes.data;

    // Assert KPI cards and chart structures are returned
    assert.ok(data.totalProjects !== undefined, 'totalProjects should be defined');
    assert.ok(data.averageRating !== undefined, 'averageRating should be defined');
    assert.ok(data.openTickets !== undefined, 'openTickets should be defined');
    assert.ok(data.requestsPerOrganization !== undefined, 'requestsPerOrganization should be defined');
    assert.ok(data.staffWorkloadDistribution !== undefined, 'staffWorkloadDistribution should be defined');
    assert.ok(data.downloadsPerDeliverable !== undefined, 'downloadsPerDeliverable should be defined');
    assert.ok(data.deliveredThisMonth !== undefined, 'deliveredThisMonth should be defined');

    addResult('Founder Acceptance Metrics API', true, 'Startup metrics, card aggregates, and chart structures successfully parsed');
  } catch (err) {
    addResult('Founder Acceptance Metrics API', false, err.message);
  }

  // Print results summary
  console.log('\n==============================================================================');
  console.log('                            SPRINT 4A TEST SUMMARY                            ');
  console.log('==============================================================================');
  
  let allPass = true;
  console.log(String.prototype.padEnd ? '' : 'Polyfill activated');
  
  results.forEach(r => {
    const namePadded = r.name.padEnd(50, '.');
    const statusFormatted = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${namePadded} [${statusFormatted}] - ${r.details}`);
    if (r.status === 'FAIL') allPass = false;
  });

  console.log('==============================================================================');
  if (allPass) {
    console.log('🎉 ALL SPRINT 4A SECURITY, MIME, AND METRICS HARDENING VALIDATIONS PASSED!');
    process.exit(0);
  } else {
    console.log('❌ SOME SPRINT 4A VALIDATIONS FAILED. REVIEW THE LOGS ABOVE.');
    process.exit(1);
  }
}

runValidation().catch(err => {
  console.error('\n❌ Integration Test Suite crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
