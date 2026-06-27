import knex from 'knex';

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
    const users = await db('users').select('*');
    console.log('PostgreSQL Users in blde_edc_dev_prod:');
    users.forEach(u => {
      console.log(`- ID: ${u.id}, Email: ${u.email}, Name: ${u.name}, Role: ${u.role}, Active: ${u.active}, PassHash: ${u.password ? 'present' : 'empty'}`);
    });
  } catch (err) {
    console.error('Error querying PostgreSQL users:', err.message);
  } finally {
    await db.destroy();
  }
}

run();
