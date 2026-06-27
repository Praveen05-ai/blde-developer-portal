import db from './src/db/connection.js';

async function main() {
  try {
    const licenses = await db('licenses').select('*');
    console.log('Client Licenses:', licenses);
  } catch (err) {
    console.error('Error querying client licenses:', err.message);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
