import knex from 'knex';
import bcrypt from 'bcryptjs';

const db = knex({
  client: 'pg',
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'blde',
    database: 'blde_edc_dev_prod'
  }
});

async function run() {
  try {
    // Check if devadmin already exists
    const existing = await db('users').where({ email: 'devadmin@blde.ac.in' }).first();
    if (existing) {
      console.log('User devadmin@blde.ac.in already exists.');
      return;
    }

    // Get the password hash for 'Admin@123'
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);

    // Insert devadmin user
    const [newUser] = await db('users')
      .insert({
        name: 'BLDE Dev Admin',
        email: 'devadmin@blde.ac.in',
        password: hashedPassword,
        role: 'admin', // maps to developer privileges
        site_id: null,
        totp_secret: null,
        totp_enabled: false,
        active: true,
        force_password_change: false,
        organization_id: null
      })
      .returning(['id', 'email', 'name']);

    console.log(`Successfully created devadmin@blde.ac.in account:`, newUser);
  } catch (err) {
    console.error('Error creating devadmin:', err.message);
  } finally {
    await db.destroy();
  }
}

run();
