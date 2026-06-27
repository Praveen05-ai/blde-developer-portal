const BASE_URL = 'http://localhost:3003/api';

async function testLockAudit() {
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
  const token = loginData.token;
  console.log('✅ Logged in successfully.');

  console.log('🔍 Fetching record database ID for participant P-001...');
  const recordsRes = await fetch(`${BASE_URL}/projects/1/records`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const records = await recordsRes.json();
  const targetRecord = records.find(r => r.record_id === 'P-001' && r.instrument_id === 1);
  if (!targetRecord) {
    console.error('❌ Record not found');
    process.exit(1);
  }

  const recordDbId = targetRecord.id;
  console.log(`🔒 Locking record ${recordDbId} (P-001) with E-Signature...`);
  const lockRes = await fetch(`${BASE_URL}/projects/1/records/${recordDbId}/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      lock: true,
      signature: 'BLDE PI Electronic Signature'
    })
  });

  const lockResult = await lockRes.json();
  console.log('✅ Lock API response:', lockResult);

  console.log('🔍 Fetching audit trail log from /api/projects/1/audit...');
  const auditRes = await fetch(`${BASE_URL}/projects/1/audit`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const logs = await auditRes.json();
  
  // Filter for participant P-001
  const p001Logs = logs.filter(l => l.record_id === 'P-001');
  console.log(`📋 Found ${p001Logs.length} audit logs for P-001`);

  const lockLog = p001Logs.find(l => l.action === 'RECORD_LOCKED');
  if (lockLog && lockLog.new_value === 'BLDE PI Electronic Signature') {
    console.log('🎉 AUDIT LOG VERIFIED! Lock action was successfully logged with signature.');
  } else {
    console.error('❌ Audit verification failed. Lock log details:', lockLog);
    process.exit(1);
  }

  console.log('🔓 Unlocking record...');
  const unlockRes = await fetch(`${BASE_URL}/projects/1/records/${recordDbId}/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      lock: false
    })
  });
  const unlockResult = await unlockRes.json();
  console.log('✅ Unlock API response:', unlockResult);

  console.log('🔍 Fetching audit logs again to verify unlock...');
  const auditRes2 = await fetch(`${BASE_URL}/projects/1/audit`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const logs2 = await auditRes2.json();
  const unlockLog = logs2.find(l => l.record_id === 'P-001' && l.action === 'RECORD_UNLOCKED');

  if (unlockLog) {
    console.log('🎉 UNLOCK AUDIT LOG VERIFIED! Unlock action was successfully logged.');
  } else {
    console.error('❌ Unlock audit verification failed.');
    process.exit(1);
  }

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

testLockAudit().catch(err => {
  console.error('❌ Error executing test:', err);
  process.exit(1);
});
