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
    const users = await db('users').select('id', 'name', 'email', 'role', 'active');
    console.log('Seeded users in blde_edc_dev_prod database:');
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error querying users:', err.message);
  } finally {
    await db.destroy();
  }
}

run();
