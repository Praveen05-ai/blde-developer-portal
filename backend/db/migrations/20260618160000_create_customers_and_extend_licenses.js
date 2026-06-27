export const up = async function (knex) {
  // 1. Create customers table
  await knex.schema.createTable('customers', (table) => {
    table.increments('id').primary();
    table.string('customer_id').unique().notNullable(); // CUS-000001
    table.string('name').notNullable();
    table.string('organization').notNullable();
    table.string('contact_person').nullable();
    table.string('email').nullable();
    table.string('mobile').nullable();
    table.text('notes').nullable();
    table.boolean('archived').defaultTo(false);
    table.timestamps(true, true);
  });

  // 2. Extend licenses table with Phase 3 fields
  await knex.schema.alterTable('licenses', (table) => {
    table.string('license_id_str').nullable(); // LIC-000001
    table.integer('license_version').defaultTo(1);
    table.integer('parent_license_id').references('id').inTable('licenses').onDelete('SET NULL').nullable();
    table.integer('customer_id').references('id').inTable('customers').onDelete('SET NULL').nullable();
    table.string('machine_name').nullable();
    table.timestamp('last_validation_date').nullable();
    table.text('notes').nullable();
    
    // Future database fields placeholder (Step 13)
    table.string('subscription_plan').nullable();
    table.string('payment_status').nullable();
    table.decimal('amount', 10, 2).nullable();
    table.string('currency').nullable();
    table.string('invoice_number').nullable();
  });
};

export const down = async function (knex) {
  // Remove columns from licenses
  await knex.schema.alterTable('licenses', (table) => {
    table.dropColumn('subscription_plan');
    table.dropColumn('payment_status');
    table.dropColumn('amount');
    table.dropColumn('currency');
    table.dropColumn('invoice_number');
    table.dropColumn('notes');
    table.dropColumn('last_validation_date');
    table.dropColumn('machine_name');
    table.dropColumn('customer_id');
    table.dropColumn('parent_license_id');
    table.dropColumn('license_version');
    table.dropColumn('license_id_str');
  });

  // Drop customers table
  await knex.schema.dropTableIfExists('customers');
};
