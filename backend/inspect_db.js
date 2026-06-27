import knex from 'knex';
import knexConfig from './knexfile.js';

const db = knex(knexConfig.development);

async function main() {
  try {
    for (const tbl of ['data_queries', 'dq_rules', 'records', 'instruments', 'users', 'projects', 'organizations']) {
      const hasTable = await db.schema.hasTable(tbl);
      if (hasTable) {
        const count = await db(tbl).count('* as cnt').first();
        console.log(`Table '${tbl}' has ${count.cnt} rows`);
      } else {
        console.log(`Table '${tbl}' does not exist`);
      }
    }
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await db.destroy();
  }
}


main();
