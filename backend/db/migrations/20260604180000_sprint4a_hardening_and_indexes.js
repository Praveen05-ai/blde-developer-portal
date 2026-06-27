export const up = async function(knex) {
  await knex.schema
    .alterTable('deliverables', (table) => {
      table.string('mime_type').nullable();
    })
    .alterTable('pilot_feedback', (table) => {
      table.string('status').defaultTo('pending'); // pending, in_progress, resolved, rejected
    });

  // Create performance indexes
  await knex.schema.alterTable('users', (table) => {
    table.index(['organization_id', 'role'], 'idx_users_org_role');
  });

  await knex.schema.alterTable('projects', (table) => {
    table.index(['organization_id', 'deleted'], 'idx_projects_org_deleted');
  });

  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.index(['organization_id', 'status'], 'idx_blueprints_org_status');
    table.index(['submitted_by'], 'idx_blueprints_submitted_by');
    table.index(['assigned_staff_id'], 'idx_blueprints_staff_id');
  });

  await knex.schema.alterTable('package_requests', (table) => {
    table.index(['organization_id', 'status'], 'idx_packages_org_status');
    table.index(['requested_by'], 'idx_packages_requested_by');
    table.index(['assigned_staff_id'], 'idx_packages_staff_id');
  });

  await knex.schema.alterTable('deliverables', (table) => {
    table.index(['related_type', 'related_id'], 'idx_deliverables_related');
  });

  await knex.schema.alterTable('notifications', (table) => {
    table.index(['user_id', 'read'], 'idx_notifications_user_read');
  });

  await knex.schema.alterTable('activity_logs', (table) => {
    table.index(['organization_id', 'created_at'], 'idx_activity_logs_org_date');
  });
};

export const down = async function(knex) {
  // Drop indexes
  await knex.schema.alterTable('activity_logs', (table) => {
    table.dropIndex(['organization_id', 'created_at'], 'idx_activity_logs_org_date');
  });

  await knex.schema.alterTable('notifications', (table) => {
    table.dropIndex(['user_id', 'read'], 'idx_notifications_user_read');
  });

  await knex.schema.alterTable('deliverables', (table) => {
    table.dropIndex(['related_type', 'related_id'], 'idx_deliverables_related');
  });

  await knex.schema.alterTable('package_requests', (table) => {
    table.dropIndex(['organization_id', 'status'], 'idx_packages_org_status');
    table.dropIndex(['requested_by'], 'idx_packages_requested_by');
    table.dropIndex(['assigned_staff_id'], 'idx_packages_staff_id');
  });

  await knex.schema.alterTable('blueprint_requests', (table) => {
    table.dropIndex(['organization_id', 'status'], 'idx_blueprints_org_status');
    table.dropIndex(['submitted_by'], 'idx_blueprints_submitted_by');
    table.dropIndex(['assigned_staff_id'], 'idx_blueprints_staff_id');
  });

  await knex.schema.alterTable('projects', (table) => {
    table.dropIndex(['organization_id', 'deleted'], 'idx_projects_org_deleted');
  });

  await knex.schema.alterTable('users', (table) => {
    table.dropIndex(['organization_id', 'role'], 'idx_users_org_role');
  });

  // Drop columns
  await knex.schema
    .alterTable('pilot_feedback', (table) => {
      table.dropColumn('status');
    })
    .alterTable('deliverables', (table) => {
      table.dropColumn('mime_type');
    });
};
