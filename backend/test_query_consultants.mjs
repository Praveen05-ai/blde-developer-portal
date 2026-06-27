import path from 'path';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const testQuery = async () => {
  const baseUrl = 'https://blde-edc-platform.onrender.com/api';
  const email = `temp_admin_${Date.now()}@blde.ac.in`;
  const password = 'Password@123';
  const name = 'Temp Admin';
  const orgName = `Temp Workspace ${Date.now()}`;

  console.log(`🚀 Registering temp admin on Render: ${email}...`);
  
  try {
    // 1. Register new workspace/tenant
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

    // 4. Fetch Consultants
    console.log('📡 Fetching consultants list from Render...');
    const consRes = await fetch(`${baseUrl}/projects/consultation/consultants`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!consRes.ok) {
      throw new Error(`Fetch consultants failed: ${consRes.status}`);
    }

    const consultants = await consRes.json();
    console.log('\n👥 CONSULTANTS ON CENTRAL RENDER SERVER:');
    console.log(JSON.stringify(consultants, null, 2));

  } catch (err) {
    console.error('❌ Query test failed:', err);
  }
};

testQuery();
