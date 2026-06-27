export const up = async function (knex) {
  const hasCreatedBy = await knex.schema.hasColumn('users', 'created_by');
  if (!hasCreatedBy) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    });
  }
};

export const down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('created_by');
  });
};
