import db from './src/db/connection.js';

async function printAll() {
  try {
    const rows = await db('licenses').select('id', 'license_id_str', 'status', 'remote_status', 'machine_id', 'created_at').orderBy('id', 'asc');
    console.log(`=== All Licenses in Client Database (${rows.length}) ===`);
    rows.forEach(r => {
      console.log(`ID: ${r.id} | License Str ID: ${r.license_id_str} | Status: ${r.status} | Remote Status: ${r.remote_status} | Created At: ${r.created_at}`);
    });
  } catch (err) {
    console.error('Error listing licenses:', err.message);
  } finally {
    process.exit(0);
  }
}

printAll();
