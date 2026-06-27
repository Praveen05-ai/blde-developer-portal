process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const runVerify = async () => {
  const baseUrl = 'https://blde-edc-platform.onrender.com/api';
  const email = 'temp_admin_1780738961263@blde.ac.in'; // From last successful test run
  const password = 'Password@123';

  console.log(`📡 Logging in to Render to verify project list visibility: ${email}...`);
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

    // Fetch projects
    console.log('📡 Querying project list from Render...');
    const projRes = await fetch(`${baseUrl}/projects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!projRes.ok) {
      throw new Error(`Fetch projects failed: ${projRes.status}`);
    }

    const projects = await projRes.json();
    console.log('\n📊 PROJECTS VISIBLE ON RENDER:');
    console.log(JSON.stringify(projects, null, 2));

  } catch (err) {
    console.error('❌ Verification failed:', err.message);
  }
};

runVerify();
