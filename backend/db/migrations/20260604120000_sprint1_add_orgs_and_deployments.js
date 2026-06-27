export const up = async function (knex) {
  // 1. Create organizations table
  await knex.schema.createTable('organizations', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('organization_type').notNullable(); // individual, university, hospital, research_center, startup, saas_tenant
    table.string('status').defaultTo('active'); // active, suspended, expired
    table.timestamps(true, true);
  });

  // 2. Create deployment_instances table
  await knex.schema.createTable('deployment_instances', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.string('deployment_mode').notNullable(); // standalone, university, saas
    table.string('version').notNullable();
    table.string('license_id').nullable();
    table.timestamp('last_checkin').defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  // 3. Alter users table to reference organizations
  await knex.schema.alterTable('users', (table) => {
    table.integer('organization_id').references('id').inTable('organizations').onDelete('SET NULL').nullable();
  });

  // 4. Alter projects table to reference organizations
  await knex.schema.alterTable('projects', (table) => {
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('organization_id');
  });

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('organization_id');
  });

  await knex.schema.dropTableIfExists('deployment_instances');
  await knex.schema.dropTableIfExists('organizations');
};
