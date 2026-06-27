export const up = async function (knex) {
  // 1. Create customers table
  const hasCustomers = await knex.schema.hasTable('customers');
  if (!hasCustomers) {
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
  }

  // 2. Extend licenses table with Phase 3 fields
  await knex.schema.alterTable('licenses', async (table) => {
    if (!await knex.schema.hasColumn('licenses', 'license_id_str')) {
      table.string('license_id_str').nullable(); // LIC-000001
    }
    if (!await knex.schema.hasColumn('licenses', 'license_version')) {
      table.integer('license_version').defaultTo(1);
    }
    if (!await knex.schema.hasColumn('licenses', 'parent_license_id')) {
      table.integer('parent_license_id').references('id').inTable('licenses').onDelete('SET NULL').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'customer_id')) {
      table.integer('customer_id').references('id').inTable('customers').onDelete('SET NULL').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'machine_name')) {
      table.string('machine_name').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'last_validation_date')) {
      table.timestamp('last_validation_date').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'notes')) {
      table.text('notes').nullable();
    }
    
    // Future database fields placeholder (Step 13)
    if (!await knex.schema.hasColumn('licenses', 'subscription_plan')) {
      table.string('subscription_plan').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'payment_status')) {
      table.string('payment_status').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'amount')) {
      table.decimal('amount', 10, 2).nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'currency')) {
      table.string('currency').nullable();
    }
    if (!await knex.schema.hasColumn('licenses', 'invoice_number')) {
      table.string('invoice_number').nullable();
    }
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
