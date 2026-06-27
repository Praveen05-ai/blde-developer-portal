import path from 'path';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const runLiveActions = async () => {
  const baseUrl = 'https://blde-edc-platform.onrender.com/api';
  const email = `temp_admin_${Date.now()}@blde.ac.in`;
  const password = 'Password@123';
  const name = 'Temp Admin';
  const orgName = `Temp Workspace ${Date.now()}`;

  console.log(`🚀 Registering temp admin on Render: ${email}...`);
  try {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password,
        organization_name: orgName
      })
    });

    if (!regRes.ok) {
      const errorText = await regRes.text();
      throw new Error(`Registration failed: ${regRes.status} - ${errorText}`);
    }

    const regData = await regRes.json();
    console.log('✅ Registered successfully.');
    
    const otp = regData.debug_otp;
    if (!otp) {
      throw new Error('No debug_otp returned in registration response!');
    }
    console.log(`🔑 Received Activation OTP: ${otp}`);

    // 2. Activate Account
    console.log(`📡 Activating account: ${email}...`);
    const actRes = await fetch(`${baseUrl}/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });

    if (!actRes.ok) {
      const errorText = await actRes.text();
      throw new Error(`Activation failed: ${actRes.status} - ${errorText}`);
    }
    console.log('✅ Account activated successfully.');

    // 3. Login
    console.log('📡 Logging in...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!loginRes.ok) {
      throw new Error(`Login failed: ${loginRes.status}`);
    }

    const loginData = await loginRes.json();
    const token = loginData.token;
    console.log('✅ Logged in successfully. Token obtained.');

    // 4. Get Tickets
    console.log('📡 Fetching synced tickets from Render...');
    const ticketsRes = await fetch(`${baseUrl}/projects/consultation/requests`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const tickets = await ticketsRes.json();
    
    // Find our CT-REAL ticket
    const ticket = tickets.find(t => t.ticket_number.includes('REAL-064327'));
    if (!ticket) {
      throw new Error('Could not find the synced CT-REAL ticket!');
    }
    console.log(`✅ Found ticket: ${ticket.ticket_number} (ID: ${ticket.id}), current status: ${ticket.status}`);

    // 5. Assign Staff
    console.log('📡 Performing staff assignment on Render...');
    const assignRes = await fetch(`${baseUrl}/projects/consultation/requests/${ticket.id}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        assigned_consultant_id: 1, // Dr. Sharan Patil
        assigned_statistician_id: 2, // Prof. Anita G.
        assigned_ai_engineer_id: 3, // Dr. Suresh K.
        assigned_db_operator_id: 4 // Amit Kumar
      })
    });

    if (!assignRes.ok) {
      const errorText = await assignRes.text();
      throw new Error(`Assign failed: ${assignRes.status} - ${errorText}`);
    }
    console.log('✅ Staff assigned successfully:', await assignRes.json());

    // 6. Deliver Config
    console.log('📡 Uploading blueprint configuration deliverable on Render...');
    const deliverRes = await fetch(`${baseUrl}/projects/consultation/requests/${ticket.id}/deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        type: 'blueprint',
        content: `# BLDE EDC Setup Blueprint\n- Project Title: E2E Real PDF Sync Verification\n- Client Name: Antigravity Real PDF Tester\n- Status: Completed & Verified\n- Date: 2026-06-06`,
        revision_notes: 'Direct E2E agent configuration delivery successfully uploaded.'
      })
    });

    if (!deliverRes.ok) {
      const errorText = await deliverRes.text();
      throw new Error(`Delivery failed: ${deliverRes.status} - ${errorText}`);
    }
    console.log('✅ Blueprint deliverable uploaded successfully:', await deliverRes.json());

    // 7. Verify Final Ticket Status
    const verifyRes = await fetch(`${baseUrl}/projects/consultation/requests`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const verifyTickets = await verifyRes.json();
    const updatedTicket = verifyTickets.find(t => t.id === ticket.id);
    console.log('\n📊 UPDATED TICKET DETAILS ON RENDER:');
    console.log(JSON.stringify({
      ticket_number: updatedTicket.ticket_number,
      status: updatedTicket.status,
      assigned_consultant: updatedTicket.consultant_name,
      assigned_statistician: updatedTicket.statistician_name,
      assigned_ai_engineer: updatedTicket.ai_engineer_name,
      assigned_db_operator: updatedTicket.db_operator_name,
      blueprint_content: updatedTicket.blueprint_content
    }, null, 2));

  } catch (err) {
    console.error('❌ Action script failed:', err);
  }
};

runLiveActions();
