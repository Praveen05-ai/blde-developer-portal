import db from './src/db/connection.js';

async function queryDetails() {
  try {
    const lic = await db('licenses').orderBy('id', 'desc').first();
    if (lic) {
      console.log('=== Active License in Client Database ===');
      console.log('ID:', lic.id);
      console.log('License Str ID:', lic.license_id_str);
      console.log('Status:', lic.status);
      console.log('Remote Status:', lic.remote_status);
      console.log('Machine ID:', lic.machine_id);
      console.log('Machine Hash:', lic.machine_hash);
      console.log('Signature:', lic.signature);
    } else {
      console.log('No license found in client DB.');
    }
  } catch (err) {
    console.error('Error querying details:', err.message);
  } finally {
    process.exit(0);
  }
}

queryDetails();
