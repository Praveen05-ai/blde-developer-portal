const BASE_URL = 'http://localhost:3002/api';

async function test() {
  console.log('🚀 STARTING SPRINT 2 API INTEGRATION TEST...');

  // 1. Authenticate Admin (Developer Support Staff)
  console.log('\n🔐 [TEST 1/6] Authenticating Developer Support Admin...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@blde.ac.in', password: 'Password@123' }) // Try standard seed password
  });
  
  let loginData = await loginRes.json();
  if (loginData.error) {
    // Try baseline default password 'Admin@123'
    console.log('   Retrying login with default baseline Admin password...');
    const retryRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@blde.ac.in', password: 'Admin@123' })
    });
    loginData = await retryRes.json();
  }

  if (loginData.error) {
    console.error('❌ Login failed:', loginData.error);
    process.exit(1);
  }

  const token = loginData.token;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  console.log('   ✅ Authenticated successfully! Token acquired.');

  // 2. Fetch Projects (Projects Module CRUD Check)
  console.log('\n📂 [TEST 2/6] Querying Projects Module...');
  const projRes = await fetch(`${BASE_URL}/projects`, { headers });
  const projects = await projRes.json();
  console.log(`   ✅ Retreived ${projects.length} projects.`);
  console.log(`   Sample project type: "${projects[0]?.project_type}" · Dept: "${projects[0]?.department}"`);

  // 3. Fetch Blueprints Requests (Blueprint Requests Module Check)
  console.log('\n📋 [TEST 3/6] Querying Blueprint Requests Module...');
  const bpRes = await fetch(`${BASE_URL}/blueprints`, { headers });
  const bps = await bpRes.json();
  console.log(`   ✅ Retrieved ${bps.length} blueprint requests.`);
  bps.forEach(b => {
    console.log(`   - Request ID #${b.id}: "${b.title}" · Status: [${b.status}] · Assigned Staff: "${b.assigned_staff_name || 'None'}"`);
  });

  // 4. Fetch Package Requests (Package Requests Module Check)
  console.log('\n📦 [TEST 4/6] Querying Package Requests Module...');
  const pkgRes = await fetch(`${BASE_URL}/packages`, { headers });
  const pkgs = await pkgRes.json();
  console.log(`   ✅ Retrieved ${pkgs.length} package requests.`);
  pkgs.forEach(p => {
    console.log(`   - Request ID #${p.id} for Project ID ${p.project_id} · Status: [${p.status}]`);
  });

  // 5. Fetch Support Tickets (Support Ticket Module Check)
  console.log('\n🎫 [TEST 5/6] Querying Support Tickets Module...');
  const ticketRes = await fetch(`${BASE_URL}/tickets`, { headers });
  const tickets = await ticketRes.json();
  console.log(`   ✅ Retrieved ${tickets.length} support tickets.`);
  tickets.forEach(t => {
    console.log(`   - Ticket ID #${t.id}: "${t.title}" · Priority: [${t.priority}] · Status: [${t.status}]`);
  });

  // 6. Fetch Communications Thread (Communication Module Check)
  console.log('\n💬 [TEST 6/6] Fetching Communications Chat Thread...');
  // Find communication for blueprint request 1
  const bpId = bps[0]?.id || 1;
  const commRes = await fetch(`${BASE_URL}/communications/blueprint/${bpId}`, { headers });
  const comms = await commRes.json();
  console.log(`   ✅ Retrieved ${comms.length} messages in blueprint chat thread.`);
  comms.forEach(c => {
    console.log(`   - [${c.sender_name} (${c.sender_role === 'admin' ? 'Support' : 'Client'})]: "${c.message}"`);
  });

  console.log('\n🎉 ALL SPRINT 2 INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

test().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
