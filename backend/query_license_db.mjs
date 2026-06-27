import db from './src/db/connection.js';

async function queryLicenses() {
  try {
    const licenses = await db('licenses').select('*');
    console.log(`Found ${licenses.length} licenses in database:`);
    licenses.forEach(l => {
      console.log(l);
    });
  } catch (err) {
    console.error('Error querying licenses:', err.message);
  } finally {
    process.exit(0);
  }
}

queryLicenses();
