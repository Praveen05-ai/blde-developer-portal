import path from 'path';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const runLiveActions = async () => {
  const baseUrl = 'https://blde-edc-platform.onrender.com/api';
  const email = 'temp_admin_1780727113302@blde.ac.in';
  const password = 'Password@123';

  console.log(`📡 Logging in to Render as admin: ${email}...`);
  try {
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
    console.log('✅ Logged in successfully.');

    // 1. Get Tickets
    console.log('📡 Fetching synced tickets...');
    const ticketsRes = await fetch(`${baseUrl}/projects/consultation/requests`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const tickets = await ticketsRes.json();
    
    // Find our CT-REAL-026732 ticket
    const ticket = tickets.find(t => t.ticket_number.includes('REAL'));
    if (!ticket) {
      throw new Error('Could not find CT-REAL-026732 ticket!');
    }
    console.log(`✅ Found ticket: ${ticket.ticket_number} (ID: ${ticket.id}), current status: ${ticket.status}`);

    // 2. Assign Staff
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

    // 3. Deliver Config
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

    // 4. Verify Final Ticket Status
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
