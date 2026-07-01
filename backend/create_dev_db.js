import pg from 'pg';

const config = {
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'blde',
  database: 'postgres' // connect to default database first
};

async function createDb() {
  const client = new pg.Client(config);
  try {
    await client.connect();
    console.log('Connected to PostgreSQL default database.');
    
    // Check if blde_edc_dev_prod exists
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname='blde_edc_dev_prod'");
    if (res.rowCount === 0) {
      // Create database
      await client.query('CREATE DATABASE blde_edc_dev_prod');
      console.log('Database blde_edc_dev_prod created successfully.');
    } else {
      console.log('Database blde_edc_dev_prod already exists.');
    }
  } catch (err) {
    console.error('Error creating database:', err.message);
  } finally {
    await client.end();
  }
}

createDb();
