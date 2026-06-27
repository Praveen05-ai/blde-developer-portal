export const up = async function(knex) {
  await knex.schema
    .alterTable('blueprint_requests', (table) => {
      table.date('estimated_completion_date').nullable();
      table.string('priority').defaultTo('Medium'); // Low, Medium, High, Urgent
      table.string('effort_estimate').nullable(); // Small, Medium, Large
      table.text('internal_progress_notes').nullable();
      table.boolean('marked_as_received').defaultTo(false);
      table.datetime('received_at').nullable();
      table.integer('rating').nullable();
      table.boolean('useful').nullable();
      table.text('feedback_text').nullable();
    })
    .alterTable('package_requests', (table) => {
      table.date('estimated_completion_date').nullable();
      table.string('priority').defaultTo('Medium');
      table.string('effort_estimate').nullable();
      table.text('internal_progress_notes').nullable();
      table.boolean('marked_as_received').defaultTo(false);
      table.datetime('received_at').nullable();
      table.integer('rating').nullable();
      table.boolean('useful').nullable();
      table.text('feedback_text').nullable();
    })
    .alterTable('deliverables', (table) => {
      table.string('category').nullable(); // Project Blueprint, Dataset Template, Data Collection Format, Annotation Protocol, Model Development Package, Source Code, Deployment Package, Documentation, Publication Support, Regulatory Documents, Custom
    })
    .createTable('pilot_feedback', (table) => {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().references('id').inTable('organizations').onDelete('CASCADE');
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.string('category').notNullable(); // bug, suggestion, feature_request, ui_issue
      table.string('severity').notNullable(); // low, medium, high, critical
      table.string('workflow_stage').notNullable(); // registration, project_creation, blueprint_request, etc.
      table.text('description').notNullable();
      table.string('screenshot_path').nullable();
      table.timestamps(true, true);
    });
};

export const down = async function(knex) {
  await knex.schema
    .alterTable('blueprint_requests', (table) => {
      table.dropColumn('estimated_completion_date');
      table.dropColumn('priority');
      table.dropColumn('effort_estimate');
      table.dropColumn('internal_progress_notes');
      table.dropColumn('marked_as_received');
      table.dropColumn('received_at');
      table.dropColumn('rating');
      table.dropColumn('useful');
      table.dropColumn('feedback_text');
    })
    .alterTable('package_requests', (table) => {
      table.dropColumn('estimated_completion_date');
      table.dropColumn('priority');
      table.dropColumn('effort_estimate');
      table.dropColumn('internal_progress_notes');
      table.dropColumn('marked_as_received');
      table.dropColumn('received_at');
      table.dropColumn('rating');
      table.dropColumn('useful');
      table.dropColumn('feedback_text');
    })
    .alterTable('deliverables', (table) => {
      table.dropColumn('category');
    })
    .dropTableIfExists('pilot_feedback');
};
