// import fetch from 'node-fetch';

async function run() {
  const loginUrl = 'http://localhost:3002/api/auth/login';
  const updateUrl = 'http://localhost:3002/api/projects/7/records/6';

  console.log('Logging in as res.hubli@blde.ac.in...');
  let loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'res.hubli@blde.ac.in', password: 'Test@123' })
  });
  let loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login failed:', loginData);
    return;
  }
  const token = loginData.token;
  console.log('Logged in successfully!');

  // Step 1: Send invalid inputs to trigger validation errors
  console.log('\n--- TEST CASE: Sending invalid range values ---');
  let invalidRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      instrument_id: 8,
      data: {
        ht_sbp: 240,
        ht_dbp: 40
      },
      status: 'complete'
    })
  });
  let invalidData = await invalidRes.json();
  console.log('Response Status:', invalidRes.status);
  console.log('Response Body:', JSON.stringify(invalidData, null, 2));

  // Step 2: Send corrected inputs
  console.log('\n--- TEST CASE: Sending corrected values ---');
  let validRes = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      instrument_id: 8,
      data: {
        ht_sbp: 142,
        ht_dbp: 92
      },
      status: 'complete'
    })
  });
  let validData = await validRes.json();
  console.log('Response Status:', validRes.status);
  console.log('Response Body:', JSON.stringify(validData, null, 2));
}

run();
