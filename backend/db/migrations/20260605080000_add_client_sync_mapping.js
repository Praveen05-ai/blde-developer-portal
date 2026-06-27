export const up = async function (knex) {
  // 1. Alter blueprint_requests to add client_license_id and client_local_id
  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.string('client_license_id').nullable();
    table.integer('client_local_id').nullable();
  });

  // 2. Alter package_requests to add client_license_id and client_local_id
  await knex.schema.alterTable('package_requests', (table) => {
    table.string('client_license_id').nullable();
    table.integer('client_local_id').nullable();
  });

  // 3. Alter support_tickets to add client_license_id and client_local_id
  await knex.schema.alterTable('support_tickets', (table) => {
    table.string('client_license_id').nullable();
    table.integer('client_local_id').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('support_tickets', (table) => {
    table.dropColumn('client_local_id');
    table.dropColumn('client_license_id');
  });

  await knex.schema.alterTable('package_requests', (table) => {
    table.dropColumn('client_local_id');
    table.dropColumn('client_license_id');
  });

  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.dropColumn('client_local_id');
    table.dropColumn('client_license_id');
  });
};
