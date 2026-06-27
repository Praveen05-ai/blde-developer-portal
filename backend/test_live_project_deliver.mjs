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

    // 5. Deliver Project Package (1000 characters long to test PostgreSQL TEXT type mapping)
    const longProjectPayload = 'A'.repeat(1000);
    console.log(`📡 Uploading long project package configuration deliverable (${longProjectPayload.length} characters)...`);
    const deliverRes = await fetch(`${baseUrl}/projects/consultation/requests/${ticket.id}/deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        type: 'project',
        content: longProjectPayload,
        revision_notes: 'Tested with a long base64 payload to verify varchar(255) alteration to TEXT.'
      })
    });

    if (!deliverRes.ok) {
      const errorText = await deliverRes.text();
      throw new Error(`Delivery failed: ${deliverRes.status} - ${errorText}`);
    }
    console.log('✅ Project package deliverable uploaded successfully:', await deliverRes.json());

    // 6. Verify Final Ticket Status and project_filename length
    const verifyRes = await fetch(`${baseUrl}/projects/consultation/requests`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const verifyTickets = await verifyRes.json();
    const updatedTicket = verifyTickets.find(t => t.id === ticket.id);
    console.log('\n📊 UPDATED TICKET DETAILS ON RENDER:');
    console.log(JSON.stringify({
      ticket_number: updatedTicket.ticket_number,
      status: updatedTicket.status,
      project_filename_length: updatedTicket.project_filename ? updatedTicket.project_filename.length : 0,
      project_filename_preview: updatedTicket.project_filename ? updatedTicket.project_filename.slice(0, 50) + '...' : null
    }, null, 2));

  } catch (err) {
    console.error('❌ Action script failed:', err);
  }
};

runLiveActions();
