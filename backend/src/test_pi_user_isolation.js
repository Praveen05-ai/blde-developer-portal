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
  const loginRes = await request('/auth/login', 'POST', { email, password });
  if (loginRes.status === 200 && loginRes.data && loginRes.data.token) {
    return { token: loginRes.data.token, user: loginRes.data.user };
  }

  const regRes = await request('/auth/register', 'POST', {
    name, email, password, role, organization_id: 1
  }, parentToken);
  if (regRes.error) {
    throw new Error(`Failed to register user ${email}: ${regRes.error}`);
  }

  const loginRes2 = await request('/auth/login', 'POST', { email, password });
  if (loginRes2.error) {
    throw new Error(`Failed to login user ${email}: ${loginRes2.error}`);
  }
  return { token: loginRes2.data.token, user: loginRes2.data.user };
}

async function runPIUserIsolationTest() {
  console.log('==============================================================================');
  console.log('🧪 Commencing PI User Directory Isolation Test...');
  console.log('==============================================================================\n');

  const unique = Date.now();

  // 0. Disable force_password_change for admin in DB
  await db('users').where({ email: 'admin@blde.ac.in' }).update({ force_password_change: false });

  // 1. Log in Admin
  const adminRes = await request('/auth/login', 'POST', { email: 'admin@blde.ac.in', password: 'Admin@123' });
  assert.strictEqual(adminRes.status, 200, 'Admin login failed');
  const adminToken = adminRes.data.token;

  // 2. Admin registers PI A
  console.log('👤 Registering PI A under Admin...');
  const piA = await getOrRegisterUser('PI A', `pi.a.${unique}@blde.ac.in`, 'Password@123', 'pi', adminToken);
  const piAToken = piA.token;
  const piAUser = piA.user;

  // 3. Admin registers PI B
  console.log('👤 Registering PI B under Admin...');
  const piB = await getOrRegisterUser('PI B', `pi.b.${unique}@blde.ac.in`, 'Password@123', 'pi', adminToken);

  // 3. PI A registers Operator A, PI B registers Operator B
  console.log('👤 Registering Operators under PIs...');
  const operatorA = await getOrRegisterUser('Operator A', `operator.a.${unique}@blde.ac.in`, 'Password@123', 'data_entry', piAToken);
  const operatorB = await getOrRegisterUser('Operator B', `operator.b.${unique}@blde.ac.in`, 'Password@123', 'student', piB.token);

  // 4. Verify user list visibility for PI A
  console.log('\n🔍 Verifying user directory isolation...');
  const usersARes1 = await request('/auth/users', 'GET', null, piAToken);
  assert.strictEqual(usersARes1.status, 200);
  const userListA1 = usersARes1.data;

  // PI A should see: self (PI A) and Operator A
  const emailsA1 = userListA1.map(u => u.email);
  assert.ok(emailsA1.includes(piAUser.email), 'PI A should see self');
  assert.ok(emailsA1.includes(operatorA.user.email), 'PI A should see Operator A (created by self)');
  assert.ok(!emailsA1.includes(piB.user.email), 'PI A should NOT see PI B (no collaboration yet)');
  assert.ok(!emailsA1.includes(operatorB.user.email), 'PI A should NOT see Operator B (no collaboration yet)');
  console.log('   ✅ PI A only sees self and Operator A');

  console.log('🔍 Verifying dashboard stats user count for PI A...');
  const statsARes1 = await request('/stats', 'GET', null, piAToken);
  assert.strictEqual(statsARes1.status, 200);
  assert.strictEqual(statsARes1.data.users, userListA1.length, `Stats user count (${statsARes1.data.users}) should match user list length (${userListA1.length})`);
  console.log('   ✅ Stats user count matches user list length');

  // 5. Admin creates Project X and assigns PI A and PI B to it
  console.log('\n📁 Creating shared Project X and assigning PIs...');
  const projRes = await request('/projects', 'POST', {
    title: `Shared Trial ${unique}`,
    project_type: 'Clinical Research Project',
    status: 'active'
  }, adminToken);
  assert.strictEqual(projRes.status, 201);
  const pid = projRes.data.id;

  // Assign PI A to Project X
  const assignPiA = await request(`/projects/${pid}/assign`, 'POST', {
    user_id: piAUser.id,
    can_view: true,
    can_edit: true
  }, adminToken);
  assert.strictEqual(assignPiA.status, 200);

  // Assign PI B to Project X
  const assignPiB = await request(`/projects/${pid}/assign`, 'POST', {
    user_id: piB.user.id,
    can_view: true,
    can_edit: true
  }, adminToken);
  assert.strictEqual(assignPiB.status, 200);

  // 6. Verify user list visibility for PI A again
  console.log('\n🔍 Verifying co-investigator visibility...');
  const usersARes2 = await request('/auth/users', 'GET', null, piAToken);
  assert.strictEqual(usersARes2.status, 200);
  const userListA2 = usersARes2.data;

  // PI A should now see PI B because they share Project X
  const emailsA2 = userListA2.map(u => u.email);
  assert.ok(emailsA2.includes(piAUser.email), 'PI A should see self');
  assert.ok(emailsA2.includes(operatorA.user.email), 'PI A should see Operator A');
  assert.ok(emailsA2.includes(piB.user.email), 'PI A should now see PI B (sharing Project X)');
  assert.ok(!emailsA2.includes(operatorB.user.email), 'PI A should still NOT see Operator B');
  console.log('   ✅ PI A can now see PI B but still cannot see Operator B');

  console.log('🔍 Verifying dashboard stats user count for PI A after project sharing...');
  const statsARes2 = await request('/stats', 'GET', null, piAToken);
  assert.strictEqual(statsARes2.status, 200);
  assert.strictEqual(statsARes2.data.users, userListA2.length, `Stats user count (${statsARes2.data.users}) should match user list length (${userListA2.length})`);
  console.log('   ✅ Stats user count matches user list length after project sharing');

  // 7. PI B assigns Operator B to Project X
  console.log('\n📁 Assigning Operator B to Project X...');
  const assignOpB = await request(`/projects/${pid}/assign`, 'POST', {
    user_id: operatorB.user.id,
    can_view: true,
    can_edit: true
  }, piB.token);
  assert.strictEqual(assignOpB.status, 200);

  // 8. Verify user list visibility for PI A finally
  console.log('\n🔍 Verifying Operator B visibility...');
  const usersARes3 = await request('/auth/users', 'GET', null, piAToken);
  assert.strictEqual(usersARes3.status, 200);
  const userListA3 = usersARes3.data;

  // PI A should now see Operator B because Operator B is assigned to Project X
  const emailsA3 = userListA3.map(u => u.email);
  assert.ok(emailsA3.includes(piAUser.email), 'PI A should see self');
  assert.ok(emailsA3.includes(operatorA.user.email), 'PI A should see Operator A');
  assert.ok(emailsA3.includes(piB.user.email), 'PI A should see PI B');
  assert.ok(emailsA3.includes(operatorB.user.email), 'PI A should now see Operator B (assigned to shared Project X)');
  console.log('   ✅ PI A can now see Operator B');

  console.log('🔍 Verifying dashboard stats user count for PI A after Operator B assignment...');
  const statsARes3 = await request('/stats', 'GET', null, piAToken);
  assert.strictEqual(statsARes3.status, 200);
  assert.strictEqual(statsARes3.data.users, userListA3.length, `Stats user count (${statsARes3.data.users}) should match user list length (${userListA3.length})`);
  console.log('   ✅ Stats user count matches user list length after Operator B assignment');

  // 9. Verify PI instrument creation, modification, and publishing
  console.log('\n📄 Testing instrument design workflow for PI A...');
  
  // Create instrument as PI A
  const createInstRes = await request(`/projects/${pid}/instruments`, 'POST', {
    name: 'PI Designed CRF',
    description: 'A case report form created by PI A',
    fields: [],
    repeating: false
  }, piAToken);
  assert.strictEqual(createInstRes.status, 201, 'PI A should be allowed to create instrument');
  const instId = createInstRes.data.id;
  console.log('   ✅ PI A successfully created instrument');

  // Update instrument fields as PI A
  const updateInstRes = await request(`/projects/${pid}/instruments/${instId}`, 'PUT', {
    name: 'PI Designed CRF',
    fields: [
      { id: 'f1', label: 'Participant Age', type: 'number', required: true }
    ],
    repeating: false
  }, piAToken);
  assert.strictEqual(updateInstRes.status, 200, 'PI A should be allowed to update instrument fields');
  console.log('   ✅ PI A successfully updated instrument fields');

  // Publish & Seal instrument as PI A
  const publishInstRes = await request(`/projects/${pid}/instruments/${instId}/publish`, 'POST', null, piAToken);
  assert.strictEqual(publishInstRes.status, 200, 'PI A should be allowed to publish and seal instrument');
  console.log('   ✅ PI A successfully published and sealed instrument');

  // Verify modifications are blocked after sealing
  const blockedUpdateRes = await request(`/projects/${pid}/instruments/${instId}`, 'PUT', {
    name: 'PI Designed CRF (Modified Post Seal)',
    fields: [],
    repeating: false
  }, piAToken);
  assert.strictEqual(blockedUpdateRes.status, 403, 'Modifying a sealed instrument should be forbidden (403)');
  console.log('   ✅ Modifying sealed instrument was correctly blocked');

  console.log('\n==============================================================================');
  console.log('🎉 PI USER DIRECTORY ISOLATION & DESIGN WORKFLOW TESTS PASSED SUCCESSFULLY!');
  console.log('==============================================================================');
}

runPIUserIsolationTest().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ PI User Isolation Test Suite crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
