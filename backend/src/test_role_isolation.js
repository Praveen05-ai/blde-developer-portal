import assert from 'assert';
import db from './db/connection.js';

const BASE_URL = 'http://localhost:3003/api';

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
      const errText = await res.text().catch(() => '');
      let errData = {};
      try { errData = JSON.parse(errText); } catch (e) {}
      return { status: res.status, error: errData.error || errText || res.statusText };
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
async function getOrRegisterUser(name, email, password, role, parentToken = null) {
  // First attempt login
  const loginRes = await request('/auth/login', 'POST', { email, password });
  if (loginRes.status === 200 && loginRes.data && loginRes.data.token) {
    return { token: loginRes.data.token, user: loginRes.data.user };
  }

  // Register
  const regRes = await request('/auth/register', 'POST', {
    name, email, password, role, organization_id: 1
  }, parentToken);
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

async function runRoleIsolationTest() {
  console.log('==============================================================================');
  console.log('🧪 Commencing Role-Based Access Model & Data Isolation Test...');
  console.log('==============================================================================\n');

  const unique = Date.now();

  // 0. Disable force_password_change for admin in DB
  await db('users').where({ email: 'admin@blde.ac.in' }).update({ force_password_change: false });

  // 1. Log in Admin
  const adminRes = await request('/auth/login', 'POST', { email: 'admin@blde.ac.in', password: 'Admin@123' });
  assert.strictEqual(adminRes.status, 200, 'Admin login failed');
  const adminToken = adminRes.data.token;

  // 2. Setup/Log in researcher
  const pi = await getOrRegisterUser('PI (researcher)', 'researcher@blde.ac.in', 'Test@123', 'pi', adminToken);
  const piToken = pi.token;
  const piUser = pi.user;

  // 2. PI registers Data Entry Operators (roles: data_entry and student)
  console.log('👤 Registering Operators under PI...');
  const deo1 = await getOrRegisterUser('Operator 1 (data_entry)', `deo1.${unique}@blde.ac.in`, 'Password@123', 'data_entry', piToken);
  const deo2 = await getOrRegisterUser('Operator 2 (student)', `student1.${unique}@blde.ac.in`, 'Password@123', 'student', piToken);
  console.log(`   - Operator 1 (data_entry) Registered: ${deo1.user.email}`);
  console.log(`   - Operator 2 (student) Registered: ${deo2.user.email}`);

  // 3. Create a test project as PI
  console.log('\n📁 Creating project and assigning operators...');
  const projRes = await request('/projects', 'POST', {
    title: `Isolation Trial ${unique}`,
    project_type: 'Clinical Research Project',
    status: 'active'
  }, piToken);
  assert.strictEqual(projRes.status, 201, 'Project creation failed');
  const pid = projRes.data.id;

  // Create Instrument
  const instRes = await request(`/projects/${pid}/instruments`, 'POST', {
    name: 'Demographics',
    fields: [
      { id: 'age', label: 'Age', type: 'number', required: true }
    ],
    repeating: false
  }, piToken);
  assert.strictEqual(instRes.status, 201, 'Instrument creation failed');
  const instId = instRes.data.id;

  // Publish Instrument
  const pubRes = await request(`/projects/${pid}/instruments/${instId}/publish`, 'POST', {}, piToken);
  assert.strictEqual(pubRes.status, 200, 'Instrument publication failed');

  // Assign Operators to Project
  const assign1 = await request(`/projects/${pid}/assign`, 'POST', {
    user_id: deo1.user.id,
    can_view: true,
    can_edit: true
  }, piToken);
  assert.strictEqual(assign1.status, 200, 'Operator 1 assignment failed');

  const assign2 = await request(`/projects/${pid}/assign`, 'POST', {
    user_id: deo2.user.id,
    can_view: true,
    can_edit: true
  }, piToken);
  assert.strictEqual(assign2.status, 200, 'Operator 2 assignment failed');

  // 4. Enroll subjects entered by different users
  console.log('\n📝 Enrolling subjects from different roles...');
  
  // Operator 1 Enrolls P-101
  const rec1Res = await request(`/projects/${pid}/records`, 'POST', {
    instrument_id: instId,
    record_id: 'P-101',
    data: { age: 30 },
    status: 'complete'
  }, deo1.token);
  assert.strictEqual(rec1Res.status, 201, 'Operator 1 subject enrollment failed');
  const rec1DbId = rec1Res.data.id;

  // Operator 2 Enrolls P-102
  const rec2Res = await request(`/projects/${pid}/records`, 'POST', {
    instrument_id: instId,
    record_id: 'P-102',
    data: { age: 40 },
    status: 'complete'
  }, deo2.token);
  assert.strictEqual(rec2Res.status, 201, 'Operator 2 subject enrollment failed');
  const rec2DbId = rec2Res.data.id;

  // PI Enrolls P-103
  const rec3Res = await request(`/projects/${pid}/records`, 'POST', {
    instrument_id: instId,
    record_id: 'P-103',
    data: { age: 50 },
    status: 'complete'
  }, piToken);
  assert.strictEqual(rec3Res.status, 201, 'PI subject enrollment failed');
  const rec3DbId = rec3Res.data.id;

  // 5. Test getRecords visibility isolation
  console.log('\n🔍 Verifying records visibility isolation...');
  
  // Operator 1 should only see P-101
  const recsDEO1 = await request(`/projects/${pid}/records`, 'GET', null, deo1.token);
  assert.strictEqual(recsDEO1.status, 200);
  assert.strictEqual(recsDEO1.data.length, 1, 'Operator 1 must see exactly one record');
  assert.strictEqual(recsDEO1.data[0].record_id, 'P-101', 'Operator 1 must only see P-101');
  console.log('   ✅ Operator 1 (data_entry) only sees P-101');

  // Operator 2 (student) should only see P-102
  const recsDEO2 = await request(`/projects/${pid}/records`, 'GET', null, deo2.token);
  assert.strictEqual(recsDEO2.status, 200);
  assert.strictEqual(recsDEO2.data.length, 1, 'Operator 2 must see exactly one record');
  assert.strictEqual(recsDEO2.data[0].record_id, 'P-102', 'Operator 2 must only see P-102');
  console.log('   ✅ Operator 2 (student) only sees P-102');

  // PI should see all three
  const recsPI = await request(`/projects/${pid}/records`, 'GET', null, piToken);
  assert.strictEqual(recsPI.status, 200);
  assert.strictEqual(recsPI.data.length, 3, 'PI must see all three records');
  console.log('   ✅ PI can see all project records (P-101, P-102, P-103)');

  // 6. Test save/lock/delete record modification restrictions
  console.log('\n🛡️  Verifying record modification restrictions (Forbidden operations)...');
  
  // Operator 1 attempts to modify PI's record (P-103)
  const editRes = await request(`/projects/${pid}/records/${rec3DbId}`, 'PUT', {
    data: { age: 55 }
  }, deo1.token);
  assert.strictEqual(editRes.status, 403, 'Operator 1 should be blocked from editing PI\'s record');
  console.log('   ✅ Operator 1 blocked from modifying PI\'s record');

  // Operator 2 attempts to lock Operator 1's record (P-101)
  const lockRes = await request(`/projects/${pid}/records/${rec1DbId}/lock`, 'POST', {
    lock: true,
    signature: 'Sealed by DEO2'
  }, deo2.token);
  assert.strictEqual(lockRes.status, 403, 'Operator 2 should be blocked from locking Operator 1\'s record');
  console.log('   ✅ Operator 2 blocked from locking Operator 1\'s record');

  // Operator 1 attempts to delete Operator 2's record (P-102)
  const delRes = await request(`/projects/${pid}/records/${rec2DbId}`, 'DELETE', null, deo1.token);
  assert.strictEqual(delRes.status, 403, 'Operator 1 should be blocked from deleting Operator 2\'s record');
  console.log('   ✅ Operator 1 blocked from deleting Operator 2\'s record');

  // 7. Test Reports & Stats isolation
  console.log('\n📊 Verifying reports and stats isolation...');
  
  // Operator 1 runs report
  const repRes = await request(`/projects/${pid}/reports/run`, 'POST', {}, deo1.token);
  assert.strictEqual(repRes.status, 200);
  assert.strictEqual(repRes.data.rows.length, 1, 'Operator 1 report must only contain their own record');
  assert.strictEqual(repRes.data.rows[0].record_id, 'P-101');
  console.log('   ✅ Operator 1 report output restricted to own records');

  // Operator 2 requests stats
  const statsRes = await request('/stats', 'GET', null, deo2.token);
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsRes.data.records, 1, 'Operator 2 stats must only count their own record');
  console.log('   ✅ Operator 2 stats count restricted to own records');

  // 8. Test CSV Export isolation
  console.log('\n📥 Verifying CSV export data isolation...');
  const csvRes = await request(`/exports/${pid}/csv`, 'GET', null, deo1.token);
  assert.strictEqual(csvRes.status, 200);
  assert.ok(csvRes.data.includes('P-101'), 'Operator 1 export must contain P-101');
  assert.ok(!csvRes.data.includes('P-102'), 'Operator 1 export must not contain P-102');
  assert.ok(!csvRes.data.includes('P-103'), 'Operator 1 export must not contain P-103');
  console.log('   ✅ CSV export restricted to only Operator 1\'s records');

  // 9. Test Concurrent Auto-Generation record IDs
  console.log('\n⚡ Verifying concurrent enrollment auto-generation (serialized locking)...');
  
  // Fire 3 simultaneous enrollment requests with auto_generated: true
  const cEnrollments = await Promise.all([
    request(`/projects/${pid}/records`, 'POST', { instrument_id: instId, auto_generated: true }, deo1.token),
    request(`/projects/${pid}/records`, 'POST', { instrument_id: instId, auto_generated: true }, deo2.token),
    request(`/projects/${pid}/records`, 'POST', { instrument_id: instId, auto_generated: true }, piToken)
  ]);

  const statuses = cEnrollments.map(e => e.status);
  assert.deepStrictEqual(statuses, [201, 201, 201], 'All concurrent enrollments must succeed');

  const createdIds = cEnrollments.map(e => e.data.record_id).sort();
  assert.strictEqual(new Set(createdIds).size, 3, 'All record IDs must be unique');
  console.log(`   ✅ Concurrent enrollment succeeded. Allocated unique record IDs: ${createdIds.join(', ')}`);

  console.log('\n==============================================================================');
  console.log('🎉 ROLE-BASED ACCESS MODEL & DATA ISOLATION TESTS PASSED SUCCESSFULLY!');
  console.log('==============================================================================');
}

runRoleIsolationTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Role Isolation Test Suite crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
