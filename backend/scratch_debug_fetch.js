const BASE_URL = 'http://127.0.0.1:3002/api';

async function test() {
  try {
    const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@blde.ac.in', password: 'Admin@123' })
    });
    const { token } = await adminLoginRes.json();
    console.log('Login token obtained.');

    const listUsersAdminRes = await fetch(`${BASE_URL}/auth/users`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await listUsersAdminRes.json();
    console.log('Users Response Status:', listUsersAdminRes.status);
    console.log('Users Response Body:', users);
  } catch (err) {
    console.error(err);
  }
}

test();
