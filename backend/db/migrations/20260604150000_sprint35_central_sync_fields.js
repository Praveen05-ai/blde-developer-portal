export const up = async function (knex) {
  // 1. Add fields to blueprint_requests
  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.boolean('sync_pending').defaultTo(false);
    table.timestamp('last_sync_attempt').nullable();
    table.text('sync_error').nullable();
  });

  // 2. Add fields to package_requests
  await knex.schema.alterTable('package_requests', (table) => {
    table.boolean('sync_pending').defaultTo(false);
    table.timestamp('last_sync_attempt').nullable();
    table.text('sync_error').nullable();
  });

  // 3. Add fields to support_tickets
  await knex.schema.alterTable('support_tickets', (table) => {
    table.boolean('sync_pending').defaultTo(false);
    table.timestamp('last_sync_attempt').nullable();
    table.text('sync_error').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('support_tickets', (table) => {
    table.dropColumn('sync_error');
    table.dropColumn('last_sync_attempt');
    table.dropColumn('sync_pending');
  });

  await knex.schema.alterTable('package_requests', (table) => {
    table.dropColumn('sync_error');
    table.dropColumn('last_sync_attempt');
    table.dropColumn('sync_pending');
  });

  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.dropColumn('sync_error');
    table.dropColumn('last_sync_attempt');
    table.dropColumn('sync_pending');
  });
};
