export const up = async function (knex) {
  await knex.schema.alterTable('survey_links', (table) => {
    table.boolean('sync_pending').defaultTo(false);
    table.timestamp('last_sync_attempt').nullable();
    table.text('sync_error').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('survey_links', (table) => {
    table.dropColumn('sync_error');
    table.dropColumn('last_sync_attempt');
    table.dropColumn('sync_pending');
  });
};
