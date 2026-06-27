export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('licenses');
  if (!hasTable) {
    await knex.schema.createTable('licenses', (table) => {
      table.increments('id').primary();
      table.text('license_key').notNullable();
      table.string('license_type').notNullable(); // trial, single_user, department, institution, lifetime
      table.string('status').notNullable().defaultTo('trial'); // trial, active, expired, suspended, revoked
      table.timestamp('activation_date').nullable();
      table.timestamp('expiry_date').nullable();
      table.text('machine_id').nullable();
      table.integer('organization_id').nullable();
      table.text('signature').notNullable();
      table.timestamps(true, true);
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('licenses');
};
