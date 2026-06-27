export const up = async function (knex) {
  await knex.schema.table('projects', (table) => {
    table.boolean('dde_enabled').defaultTo(false);
  });
};

export const down = async function (knex) {
  await knex.schema.table('projects', (table) => {
    table.dropColumn('dde_enabled');
  });
};
