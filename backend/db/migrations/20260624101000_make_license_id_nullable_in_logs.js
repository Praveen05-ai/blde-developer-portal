export const up = async function (knex) {
  await knex.schema.alterTable('license_logs', (table) => {
    table.integer('license_id').unsigned().nullable().alter();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('license_logs', (table) => {
    table.integer('license_id').unsigned().notNullable().alter();
  });
};
