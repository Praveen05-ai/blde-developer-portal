export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('records', 'version_id');
  if (!hasColumn) {
    await knex.schema.alterTable('records', (table) => {
      table.integer('version_id').defaultTo(1);
    });
  }
}

export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('records', 'version_id');
  if (hasColumn) {
    await knex.schema.alterTable('records', (table) => {
      table.dropColumn('version_id');
    });
  }
}
