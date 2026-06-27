export const up = async function (knex) {
  // 1. Create internal_notes table
  await knex.schema.createTable('internal_notes', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').nullable();
    table.string('related_type').notNullable(); // blueprint, package, ticket
    table.integer('related_id').notNullable();
    table.integer('staff_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.text('note').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. Create deliverables table
  await knex.schema.createTable('deliverables', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.string('related_type').notNullable(); // blueprint, package, report, dataset, source_code, publication, certificate, custom
    table.integer('related_id').notNullable();
    table.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('name').notNullable();
    table.string('file_path').notNullable();
    table.integer('file_size').notNullable();
    table.string('checksum').notNullable(); // SHA-256
    table.integer('version').defaultTo(1);
    table.text('delivery_notes').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. Create deliverable_downloads table
  await knex.schema.createTable('deliverable_downloads', (table) => {
    table.increments('id').primary();
    table.integer('deliverable_id').references('id').inTable('deliverables').onDelete('CASCADE').notNullable();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.string('ip_address').nullable();
    table.timestamp('downloaded_at').defaultTo(knex.fn.now());
  });

  // 4. Create assignment_history table
  await knex.schema.createTable('assignment_history', (table) => {
    table.increments('id').primary();
    table.string('request_type').notNullable(); // blueprint, package, ticket, etc.
    table.integer('request_id').notNullable();
    table.integer('assigned_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.integer('assigned_to').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.text('reason').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 5. Create activity_logs table
  await knex.schema.createTable('activity_logs', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').nullable();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('entity_type').notNullable(); // project, blueprint, package, ticket, note, deliverable, etc.
    table.integer('entity_id').notNullable();
    table.string('action').notNullable(); // create, submit, assign, status_change, note_add, upload, download, reply, close
    table.text('metadata_json').nullable(); // JSON formatted details
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 6. Create notifications table
  await knex.schema.createTable('notifications', (table) => {
    table.increments('id').primary();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.string('title').notNullable();
    table.text('message').notNullable();
    table.boolean('read').defaultTo(false);
    table.string('related_type').nullable(); // blueprint, package, ticket
    table.integer('related_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('activity_logs');
  await knex.schema.dropTableIfExists('assignment_history');
  await knex.schema.dropTableIfExists('deliverable_downloads');
  await knex.schema.dropTableIfExists('deliverables');
  await knex.schema.dropTableIfExists('internal_notes');
};
