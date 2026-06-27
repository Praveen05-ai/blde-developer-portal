export const up = async function (knex) {
  // 1. CONSULTANTS
  await knex.schema.createTable('consultants', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').unique().notNullable();
    table.string('role').notNullable(); // consultant, statistician, ai_engineer, db_operator, qa
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. CONSULTATION TICKETS
  await knex.schema.createTable('consultation_tickets', (table) => {
    table.increments('id').primary();
    table.string('ticket_number').unique().notNullable();
    table.string('client_name').notNullable();
    table.string('client_email').notNullable();
    table.string('department').notNullable();
    table.string('principal_investigator').notNullable();
    table.string('project_title').notNullable();
    table.text('expected_outcome').notNullable();
    table.string('reference_pdf_filename').nullable();
    table.text('additional_notes').nullable();
    table.integer('assigned_consultant_id').references('id').inTable('consultants').onDelete('SET NULL').nullable();
    table.integer('assigned_statistician_id').references('id').inTable('consultants').onDelete('SET NULL').nullable();
    table.integer('assigned_ai_engineer_id').references('id').inTable('consultants').onDelete('SET NULL').nullable();
    table.integer('assigned_db_operator_id').references('id').inTable('consultants').onDelete('SET NULL').nullable();
    table.string('status').defaultTo('submitted'); // submitted, assigned, under_review, blueprint_ready, approved, build_in_progress, setup_delivered, closed
    table.text('blueprint_content').nullable();
    table.text('revision_notes').nullable();
    table.string('blueprint_filename').nullable();
    table.string('project_filename').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('consultation_tickets');
  await knex.schema.dropTableIfExists('consultants');
};
