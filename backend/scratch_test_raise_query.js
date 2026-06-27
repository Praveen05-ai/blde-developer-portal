const BASE_URL = 'http://localhost:3003/api';

async function testRaiseQuery() {
  console.log('🔑 Logging in as PI...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'researcher@blde.ac.in',
      password: 'Test@123'
    })
  });

  const loginData = await loginRes.json();
  if (loginData.error || !loginData.token) {
    console.error('❌ Login failed:', loginData.error || 'No token returned');
    process.exit(1);
  }

  const token = loginData.token;
  console.log('✅ Logged in successfully. Token obtained.');

  // Find a completed record for demographics (instrument 1) on project 1
  console.log('🔍 Fetching records for project 1...');
  const recordsRes = await fetch(`${BASE_URL}/projects/1/records`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const records = await recordsRes.json();
  const targetRecord = records.find(r => r.record_id === 'P-001' && r.instrument_id === 1);
  if (!targetRecord) {
    console.error('❌ Target record P-001 not found.');
    process.exit(1);
  }
  console.log(`✅ Found record P-001 (db id: ${targetRecord.id})`);

  console.log('💬 Raising a manual query on participant P-001, field: age...');
  const queryPayload = {
    record_id: 'P-001',
    record_db_id: targetRecord.id,
    instrument_id: 1,
    field_id: 'age',
    query_text: 'PI manual verification: Age value needs medical chart cross-reference.',
    severity: 'warning'
  };

  const raiseRes = await fetch(`${BASE_URL}/projects/1/queries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(queryPayload)
  });

  const raisedQuery = await raiseRes.json();
  if (raisedQuery.error) {
    console.error('❌ Failed to raise query:', raisedQuery.error);
    process.exit(1);
  }

  console.log('✅ Query raised successfully:', raisedQuery);

  console.log('🔍 Verifying query is present in project queries list...');
  const queriesRes = await fetch(`${BASE_URL}/projects/1/queries`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const queries = await queriesRes.json();
  const found = queries.find(q => q.id === raisedQuery.id);

  if (found && found.status === 'open' && found.field_id === 'age') {
    console.log('🎉 TEST SUCCESSFUL! Query is active, open, and matches field ID age.');
  } else {
    console.error('❌ Query verification failed. Found query details:', found);
    process.exit(1);
  }
}

testRaiseQuery().catch(err => {
  console.error('❌ Error executing test:', err);
  process.exit(1);
});
