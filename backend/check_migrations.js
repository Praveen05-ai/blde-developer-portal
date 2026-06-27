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

async function check() {
  try {
    const tables = await db.raw("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log('Existing tables:', tables.rows.map(r => r.table_name));
    
    // check applied migrations
    const exists = await db.schema.hasTable('knex_migrations');
    if (exists) {
      const migrations = await db('knex_migrations').select('*');
      console.log('Applied migrations:', migrations.map(m => m.name));
    } else {
      console.log('knex_migrations table does not exist.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await db.destroy();
  }
}

check();
