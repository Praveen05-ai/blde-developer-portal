export const up = async function (knex) {
  // 1. Create subscription_plans table
  const hasSubPlans = await knex.schema.hasTable('subscription_plans');
  if (!hasSubPlans) {
    await knex.schema.createTable('subscription_plans', (table) => {
      table.increments('id').primary();
      table.string('plan_code').unique().notNullable();
      table.string('plan_name').notNullable();
      table.string('license_type').notNullable();
      table.integer('duration_days').nullable(); // null for unlimited
      table.decimal('amount', 10, 2).notNullable();
      table.string('currency').defaultTo('INR');
      table.integer('max_projects').nullable();
      table.integer('max_users').nullable();
      table.integer('max_forms').nullable();
      table.integer('max_records').nullable();
      table.integer('max_storage_gb').nullable();
      table.integer('max_upload_mb').nullable();
      table.integer('max_sessions').nullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
    });

    // Seed default plans
    await knex('subscription_plans').insert([
      {
        plan_code: 'TRIAL',
        plan_name: 'Trial',
        license_type: 'trial',
        duration_days: 7,
        amount: 0.00,
        currency: 'INR',
        max_projects: 3,
        max_users: 2,
        max_forms: 10,
        max_records: 1000,
        max_storage_gb: 1,
        max_upload_mb: 10,
        max_sessions: 5,
        is_active: true
      },
      {
        plan_code: 'SINGLE_USER',
        plan_name: 'Single User',
        license_type: 'single',
        duration_days: 365,
        amount: 15000.00,
        currency: 'INR',
        max_projects: 10,
        max_users: 1,
        max_forms: 20,
        max_records: 10000,
        max_storage_gb: 5,
        max_upload_mb: 25,
        max_sessions: 10,
        is_active: true
      },
      {
        plan_code: 'DEPARTMENT',
        plan_name: 'Department',
        license_type: 'department',
        duration_days: 365,
        amount: 50000.00,
        currency: 'INR',
        max_projects: 50,
        max_users: 10,
        max_forms: 100,
        max_records: 100000,
        max_storage_gb: 50,
        max_upload_mb: 100,
        max_sessions: 50,
        is_active: true
      },
      {
        plan_code: 'INSTITUTION',
        plan_name: 'Institution',
        license_type: 'institutional',
        duration_days: 365,
        amount: 200000.00,
        currency: 'INR',
        max_projects: 500,
        max_users: 100,
        max_forms: 500,
        max_records: 1000000,
        max_storage_gb: 500,
        max_upload_mb: 500,
        max_sessions: 500,
        is_active: true
      },
      {
        plan_code: 'LIFETIME',
        plan_name: 'Lifetime',
        license_type: 'lifetime',
        duration_days: 99999, // unlimited representation
        amount: 1000000.00,
        currency: 'INR',
        max_projects: 999999,
        max_users: 999999,
        max_forms: 999999,
        max_records: 999999,
        max_storage_gb: 9999,
        max_upload_mb: 5000,
        max_sessions: 9999,
        is_active: true
      }
    ]);
  }

  // 2. Create subscriptions table
  const hasSubscriptions = await knex.schema.hasTable('subscriptions');
  if (!hasSubscriptions) {
    await knex.schema.createTable('subscriptions', (table) => {
      table.increments('id').primary();
      table.integer('customer_id').unsigned().notNullable()
        .references('id').inTable('customers').onDelete('CASCADE');
      table.integer('license_id').unsigned().nullable()
        .references('id').inTable('licenses').onDelete('SET NULL');
      table.integer('plan_id').unsigned().notNullable()
        .references('id').inTable('subscription_plans').onDelete('CASCADE');
      table.integer('subscription_version').defaultTo(1);
      table.integer('parent_subscription_id').unsigned().nullable()
        .references('id').inTable('subscriptions').onDelete('SET NULL');
      table.timestamp('start_date').nullable();
      table.timestamp('end_date').nullable();
      table.timestamp('renewal_date').nullable();
      table.string('status').defaultTo('payment_pending'); // active, expired, payment_pending, cancelled, suspended, renewed, archived
      table.boolean('auto_renew').defaultTo(false);
      table.integer('grace_days').defaultTo(7);
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
  }

  // 3. Create invoices table
  const hasInvoices = await knex.schema.hasTable('invoices');
  if (!hasInvoices) {
    await knex.schema.createTable('invoices', (table) => {
      table.increments('id').primary();
      table.string('invoice_number').unique().notNullable(); // INV-2026-000001
      table.integer('customer_id').unsigned().notNullable()
        .references('id').inTable('customers').onDelete('CASCADE');
      table.integer('subscription_id').unsigned().notNullable()
        .references('id').inTable('subscriptions').onDelete('CASCADE');
      table.decimal('amount', 10, 2).notNullable();
      table.string('currency').defaultTo('INR');
      table.timestamp('issue_date').notNullable();
      table.timestamp('due_date').notNullable();
      table.string('status').defaultTo('unpaid'); // unpaid, paid, overdue, cancelled
      table.string('payment_method').nullable();
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
  }

  // 4. Create payments table
  const hasPayments = await knex.schema.hasTable('payments');
  if (!hasPayments) {
    await knex.schema.createTable('payments', (table) => {
      table.increments('id').primary();
      table.integer('invoice_id').unsigned().notNullable()
        .references('id').inTable('invoices').onDelete('CASCADE');
      table.string('transaction_reference').unique().notNullable();
      table.decimal('amount', 10, 2).notNullable();
      table.string('currency').defaultTo('INR');
      table.timestamp('payment_date').notNullable();
      table.string('payment_method').notNullable(); // Cash, UPI, Bank Transfer, Cheque, Razorpay, Stripe, PayPal
      table.string('status').defaultTo('pending'); // success, failed, pending, refunded
      table.text('notes').nullable();
      table.timestamps(true, true);
    });
  }

  // 5. Create billing_logs table
  const hasBillingLogs = await knex.schema.hasTable('billing_logs');
  if (!hasBillingLogs) {
    await knex.schema.createTable('billing_logs', (table) => {
      table.increments('id').primary();
      table.integer('customer_id').unsigned().notNullable()
        .references('id').inTable('customers').onDelete('CASCADE');
      table.integer('subscription_id').unsigned().nullable()
        .references('id').inTable('subscriptions').onDelete('SET NULL');
      table.integer('invoice_id').unsigned().nullable()
        .references('id').inTable('invoices').onDelete('SET NULL');
      table.integer('payment_id').unsigned().nullable()
        .references('id').inTable('payments').onDelete('SET NULL');
      table.string('action').notNullable(); // invoice_created, payment_received, renewal_success, renewal_failure, subscription_expired, payment_pending, grace_started, grace_expired, invoice_cancelled, refund_processed
      table.text('details').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('billing_logs');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('subscription_plans');
};
