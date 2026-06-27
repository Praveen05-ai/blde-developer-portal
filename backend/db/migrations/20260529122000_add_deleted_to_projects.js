export const up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('projects', 'deleted');
  if (!hasColumn) {
    await knex.schema.alterTable('projects', (table) => {
      table.boolean('deleted').defaultTo(false);
    });
  }
};

export const down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('projects', 'deleted');
  if (hasColumn) {
    await knex.schema.alterTable('projects', (table) => {
      table.dropColumn('deleted');
    });
  }
};
