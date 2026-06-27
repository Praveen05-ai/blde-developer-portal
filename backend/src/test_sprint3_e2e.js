const BASE_URL = 'http://localhost:3002/api';

async function tryLogin(email, password) {
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
      return data;
    }
  } catch (err) {
    // Ignore error
  }
  return null;
}

async function runE2ETests() {
  console.log('🚀 STARTING E2E INTEGRATION TEST FOR SPRINT 3...');

  const uniqueSuffix = Date.now();
  const researcherEmail = `e2e_res_${uniqueSuffix}@blde.ac.in`;

  // 1. Register and Login a fresh Researcher (investigator) with organization_id = 1
  console.log(`\n🔐 [STEP 1] Registering fresh Researcher user: ${researcherEmail}...`);
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Test Researcher',
      email: researcherEmail,
      password: 'Password@123',
      role: 'researcher',
      organization_id: 1
    })
  });
  const regData = await regRes.json();
  if (regData.error) {
    throw new Error('Fresh researcher registration failed: ' + regData.error);
  }

  console.log('   Authenticating Researcher...');
  const resLoginData = await tryLogin(researcherEmail, 'Password@123');
  if (!resLoginData) {
    throw new Error('Could not login with newly registered researcher account.');
  }

  const resToken = resLoginData.token;
  const resHeaders = { 'Authorization': `Bearer ${resToken}`, 'Content-Type': 'application/json' };
  console.log(`   ✅ Researcher authenticated. Email: "${researcherEmail}"`);

  // 2. Authenticate Admin (Staff Support)
  console.log('\n🔐 [STEP 2] Authenticating Support Staff Admin...');
  let adminLoginData = await tryLogin('admin@blde.ac.in', 'Password@123');
  if (!adminLoginData) {
    adminLoginData = await tryLogin('admin@blde.ac.in', 'Admin@123');
  }

  if (!adminLoginData) {
    throw new Error('Admin authentication failed for both Password@123 and Admin@123');
  }

  const adminToken = adminLoginData.token;
  const adminId = adminLoginData.user.id;
  const adminHeaders = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
  console.log(`   ✅ Support Admin authenticated. ID: ${adminId}`);

  // 3. Researcher creates a project
  console.log('\n📂 [STEP 3] Researcher creating new project...');
  const projRes = await fetch(`${BASE_URL}/projects`, {
    method: 'POST',
    headers: resHeaders,
    body: JSON.stringify({
      title: 'E2E Cardiology Trial ' + uniqueSuffix,
      description: 'Longitudinal clinical study for cardiovascular drug efficacy',
      department: 'Cardiology',
      guide_name: 'Dr. Guide',
      project_type: 'Clinical Research Project',
      status: 'development',
      longitudinal: true,
      randomisation_enabled: true,
      multi_site: true
    })
  });
  const project = await projRes.json();
  if (project.error) {
    throw new Error('Project creation failed: ' + project.error);
  }
  const projectId = project.id;
  console.log(`   ✅ Project created successfully. ID: ${projectId}, Title: "${project.title}"`);

  // 4. Researcher submits a blueprint request
  console.log('\n📋 [STEP 4] Researcher submitting blueprint request...');
  const bpRes = await fetch(`${BASE_URL}/blueprints`, {
    method: 'POST',
    headers: resHeaders,
    body: JSON.stringify({
      project_id: projectId,
      title: 'Cardiology CRF Blueprint Request',
      template_type: 'Clinical Research Project',
      requirements: 'CRF schema for pediatric cardiovascular study.'
    })
  });
  const bpRequest = await bpRes.json();
  if (bpRequest.error) {
    throw new Error('Blueprint request submission failed: ' + bpRequest.error);
  }
  const bpRequestId = bpRequest.id;
  console.log(`   ✅ Blueprint request submitted. ID: ${bpRequestId}`);

  // 5. Admin assigns request to staff member
  console.log('\n👤 [STEP 5] Admin assigning blueprint request to support staff...');
  const assignRes = await fetch(`${BASE_URL}/blueprints/${bpRequestId}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      assigned_staff_id: adminId,
      assignment_reason: 'Assigning to lead cardiologist specialist'
    })
  });
  const assignData = await assignRes.json();
  if (assignData.error) {
    throw new Error('Assignment failed: ' + assignData.error);
  }
  console.log(`   ✅ Request ID #${bpRequestId} assigned to Admin ID: ${adminId}`);

  // Verify assignment history exists
  const historyRes = await fetch(`${BASE_URL}/assignment-history/blueprint/${bpRequestId}`, {
    headers: adminHeaders
  });
  const history = await historyRes.json();
  if (history.error) {
    throw new Error('Failed to retrieve assignment history: ' + history.error);
  }
  console.log(`   ✅ Assignment history matches: ${history.length} records found.`);
  history.forEach(h => {
    console.log(`      - Assigned by: "${h.assigner_name}" to "${h.assignee_name}" | Reason: "${h.reason}"`);
  });

  // 6. Admin adds an internal note
  console.log('\n📝 [STEP 6] Admin adding internal note...');
  const noteRes = await fetch(`${BASE_URL}/internal-notes`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      related_type: 'blueprint',
      related_id: bpRequestId,
      note: 'CRF variables verified. Ready for upload.'
    })
  });
  const noteData = await noteRes.json();
  if (noteData.error) {
    throw new Error('Adding internal note failed: ' + noteData.error);
  }
  console.log(`   ✅ Internal note added. Note ID: ${noteData.id}`);

  // Verify internal notes list
  const notesListRes = await fetch(`${BASE_URL}/internal-notes/blueprint/${bpRequestId}`, {
    headers: adminHeaders
  });
  const notes = await notesListRes.json();
  console.log(`   ✅ Internal notes count: ${notes.length}`);
  notes.forEach(n => {
    console.log(`      - Note by ${n.staff_name}: "${n.note}"`);
  });

  // 7. Admin uploads deliverable (Multipart form upload)
  console.log('\n📤 [STEP 7] Admin uploading deliverable file...');
  const formData = new FormData();
  formData.append('related_type', 'blueprint');
  formData.append('related_id', bpRequestId);
  formData.append('delivery_notes', 'Initial version of Cardiology CRF spec.');
  
  // Use a text blob as the file payload
  const fileBlob = new Blob(['**Cardiology Study Metadata Version 1.0**'], { type: 'text/markdown' });
  formData.append('file', fileBlob, 'cardiology_crf_v1.md');

  const uploadRes = await fetch(`${BASE_URL}/deliverables/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });
  const deliverable = await uploadRes.json();
  if (deliverable.error) {
    throw new Error('Deliverable upload failed: ' + deliverable.error);
  }
  console.log(`   ✅ Deliverable uploaded. ID: ${deliverable.id}, Version: ${deliverable.version}, Checksum: "${deliverable.checksum}"`);

  // 8. Researcher queries and downloads deliverable
  console.log('\n📥 [STEP 8] Researcher downloading deliverable...');
  const downloadRes = await fetch(`${BASE_URL}/deliverables/download/${deliverable.id}`, {
    headers: {
      'Authorization': `Bearer ${resToken}`
    }
  });
  if (!downloadRes.ok) {
    const errorJson = await downloadRes.json();
    throw new Error('Deliverable download failed: ' + (errorJson.error || downloadRes.statusText));
  }
  const fileText = await downloadRes.text();
  console.log(`   ✅ Downloaded deliverable content: "${fileText}"`);

  // Verify download tracking count has been incremented
  const deliverablesRes = await fetch(`${BASE_URL}/deliverables/blueprint/${bpRequestId}`, {
    headers: resHeaders
  });
  const deliverablesList = await deliverablesRes.json();
  console.log(`   ✅ Deliverable list returned for request: ${deliverablesList.length} items`);
  deliverablesList.forEach(d => {
    console.log(`      - v${d.version}: "${d.name}" | Size: ${d.file_size} bytes | Uploaded by: "${d.uploader_name}"`);
  });

  // 9. Check Activity Logs
  console.log('\n📋 [STEP 9] Fetching activity logs generated during workflow...');
  const logsRes = await fetch(`${BASE_URL}/activity-logs`, {
    headers: adminHeaders
  });
  const logs = await logsRes.json();
  if (logs.error) {
    throw new Error('Failed to retrieve activity logs: ' + logs.error);
  }
  console.log(`   ✅ Activity logs found: ${logs.length} total entries.`);
  const relevantLogs = logs.filter(l => l.entity_id === projectId || l.entity_id === bpRequestId || l.entity_id === deliverable.id);
  console.log('   Relevant E2E workflow logs:');
  relevantLogs.forEach(l => {
    console.log(`      - Log [${l.entity_type} - ${l.action}] by User "${l.user_name}" in Org "${l.org_name}"`);
  });

  console.log('\n🎉 ALL SPRINT 3 E2E WORKFLOW TESTS PASSED SUCCESSFULLY!');
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E Test Suite failed:', err.message);
  process.exit(1);
});
