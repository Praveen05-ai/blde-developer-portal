export const up = async function (knex) {
  await knex.schema.alterTable('consultation_tickets', (table) => {
    table.boolean('sync_pending').defaultTo(false);
    table.string('client_license_id').nullable();
    table.integer('client_local_id').nullable();
    table.timestamp('last_sync_attempt').nullable();
    table.text('sync_error').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('consultation_tickets', (table) => {
    table.dropColumn('sync_error');
    table.dropColumn('last_sync_attempt');
    table.dropColumn('client_local_id');
    table.dropColumn('client_license_id');
    table.dropColumn('sync_pending');
  });
};
