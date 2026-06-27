export const up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.boolean('active').defaultTo(true).notNullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('active');
  });
};
