export const up = async function (knex) {
  // 1. Alter projects table to add department, guide_name, and project_type
  await knex.schema.alterTable('projects', (table) => {
    table.string('department').nullable();
    table.string('guide_name').nullable();
    table.string('project_type').nullable(); // AI Medical Project, Clinical Research Project, etc.
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // 2. Create blueprint_requests table
  await knex.schema.createTable('blueprint_requests', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.integer('project_id').references('id').inTable('projects').onDelete('SET NULL').nullable();
    table.integer('submitted_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('title').notNullable();
    table.string('template_type').notNullable(); // ai_medical, clinical_research, etc.
    table.text('requirements').notNullable();
    table.string('status').defaultTo('draft'); // draft, submitted, under_review, assigned, in_progress, ready_for_delivery, delivered, closed
    table.integer('assigned_staff_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamps(true, true);
  });

  // 3. Create package_requests table
  await knex.schema.createTable('package_requests', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.integer('requested_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.text('requirements').notNullable();
    table.string('status').defaultTo('draft'); // draft, submitted, assigned, development, qa_review, ready_for_delivery, delivered, closed
    table.integer('assigned_staff_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamps(true, true);
  });

  // 4. Create support_tickets table
  await knex.schema.createTable('support_tickets', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('title').notNullable();
    table.text('description').notNullable();
    table.string('priority').defaultTo('medium'); // low, medium, high, critical
    table.string('status').defaultTo('open'); // open, assigned, in_progress, resolved, closed
    table.timestamps(true, true);
  });

  // 5. Create communications table
  await knex.schema.createTable('communications', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE').notNullable();
    table.string('related_type').notNullable(); // blueprint, package, ticket
    table.integer('related_id').notNullable(); // links to corresponding table id
    table.integer('sender_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.text('message').notNullable();
    table.string('attachment_path').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('communications');
  await knex.schema.dropTableIfExists('support_tickets');
  await knex.schema.dropTableIfExists('package_requests');
  await knex.schema.dropTableIfExists('blueprint_requests');

  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('department');
    table.dropColumn('guide_name');
    table.dropColumn('project_type');
    table.dropColumn('updated_at');
  });
};
