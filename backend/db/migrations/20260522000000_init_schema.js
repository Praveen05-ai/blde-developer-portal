export const up = async function (knex) {
  // 1. USERS
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').unique().notNullable();
    table.string('password').notNullable();
    table.string('role').defaultTo('researcher');
    table.integer('site_id').nullable(); // Will link to sites once created
    table.string('totp_secret').nullable();
    table.boolean('totp_enabled').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. PROJECTS
  await knex.schema.createTable('projects', (table) => {
    table.increments('id').primary();
    table.string('title').notNullable();
    table.text('description').nullable();
    table.string('status').defaultTo('development'); // development, production, analysis
    table.boolean('longitudinal').defaultTo(false);
    table.boolean('randomisation_enabled').defaultTo(false);
    table.boolean('multi_site').defaultTo(false);
    table.boolean('deleted').defaultTo(false);
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 3. SITES (DATA ACCESS GROUPS)
  await knex.schema.createTable('sites', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.string('code').notNullable();
    table.string('city').nullable();
    table.string('pi_name').nullable();
    table.string('pi_email').nullable();
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Alter users to reference sites now that sites table is created
  await knex.schema.alterTable('users', (table) => {
    table.foreign('site_id').references('id').inTable('sites').onDelete('SET NULL');
  });

  // 4. INSTRUMENTS
  await knex.schema.createTable('instruments', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.jsonb('fields').defaultTo('[]'); // PostgreSQL jsonb is premium for querying fields
    table.boolean('repeating').defaultTo(false);
    table.string('status').defaultTo('draft'); // draft, published
    table.timestamp('published_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 5. EVENTS (LONGITUDINAL SETUP)
  await knex.schema.createTable('events', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.integer('day_offset').defaultTo(0);
    table.integer('window_before').defaultTo(0);
    table.integer('window_after').defaultTo(0);
    table.text('description').nullable();
    table.integer('sort_order').defaultTo(0);
  });

  // 6. EVENT INSTRUMENTS (JOIN TABLE)
  await knex.schema.createTable('event_instruments', (table) => {
    table.integer('event_id').references('id').inTable('events').onDelete('CASCADE').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').notNullable();
    table.boolean('required').defaultTo(true);
    table.primary(['event_id', 'instrument_id']);
  });

  // 7. RECORDS
  await knex.schema.createTable('records', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').notNullable();
    table.string('record_id').notNullable();
    table.integer('event_id').references('id').inTable('events').onDelete('SET NULL').nullable();
    table.integer('site_id').references('id').inTable('sites').onDelete('SET NULL').nullable();
    table.integer('repeat_instance').defaultTo(1);
    table.jsonb('data').defaultTo('{}'); // JSONB for fast indexing and searches
    table.string('status').defaultTo('incomplete'); // incomplete, complete, unverified
    table.integer('version_id').defaultTo(1);
    table.boolean('locked').defaultTo(false);
    table.integer('locked_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('locked_at').nullable();
    table.text('lock_signature').nullable();
    table.integer('entered_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // 8. PROJECT USERS PERMISSIONS
  await knex.schema.createTable('project_users', (table) => {
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.integer('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.boolean('can_view').defaultTo(true);
    table.boolean('can_edit').defaultTo(false);
    table.boolean('can_delete').defaultTo(false);
    table.boolean('can_export').defaultTo(false);
    table.boolean('can_manage').defaultTo(false);
    table.primary(['project_id', 'user_id']);
  });

  // 9. AUDIT LOG
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').nullable();
    table.string('record_id').nullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').nullable();
    table.integer('user_id').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.string('user_name').nullable();
    table.string('action').notNullable();
    table.string('field_name').nullable();
    table.text('old_value').nullable();
    table.text('new_value').nullable();
    table.string('ip_address').nullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now());
  });

  // 10. SURVEY LINKS (PUBLIC COLLECTION)
  await knex.schema.createTable('survey_links', (table) => {
    table.increments('id').primary();
    table.string('token').unique().notNullable();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').notNullable();
    table.string('label').nullable();
    table.boolean('active').defaultTo(true);
    table.integer('responses').defaultTo(0);
    table.timestamp('expires_at').nullable();
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 11. PATIENT LONGITUDINAL EVENTS
  await knex.schema.createTable('patient_events', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('record_id').notNullable();
    table.integer('event_id').references('id').inTable('events').onDelete('CASCADE').notNullable();
    table.date('scheduled_date').nullable();
    table.date('actual_date').nullable();
    table.string('status').defaultTo('scheduled'); // scheduled, completed, missed, skipped
    table.text('notes').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 12. FILE ATTACHMENTS
  await knex.schema.createTable('attachments', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('record_id').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').nullable();
    table.string('field_id').nullable();
    table.string('filename').notNullable();
    table.string('original_name').notNullable();
    table.string('mimetype').nullable();
    table.integer('size').notNullable();
    table.integer('uploaded_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('uploaded_at').defaultTo(knex.fn.now());
  });

  // 13. DOUBLE DATA ENTRY (DDE)
  await knex.schema.createTable('dde_records', (table) => {
    table.increments('id').primary();
    table.integer('primary_record_id').nullable(); // Links to records table
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').notNullable();
    table.string('record_id').notNullable();
    table.jsonb('data').defaultTo('{}');
    table.string('status').defaultTo('pending'); // pending, conflict, resolved
    table.integer('entered_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.jsonb('discrepancies').defaultTo('[]');
    table.boolean('resolved').defaultTo(false);
    table.integer('resolved_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('resolved_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 14. ALERT RULES
  await knex.schema.createTable('alert_rules', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').nullable();
    table.string('trigger_field').nullable();
    table.string('trigger_operator').defaultTo('=');
    table.string('trigger_value').nullable();
    table.string('alert_type').defaultTo('email');
    table.jsonb('recipients').defaultTo('[]');
    table.string('subject').nullable();
    table.text('message').nullable();
    table.boolean('active').defaultTo(true);
    table.integer('fire_count').defaultTo(0);
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 15. ALERT LOGS
  await knex.schema.createTable('alert_log', (table) => {
    table.increments('id').primary();
    table.integer('rule_id').references('id').inTable('alert_rules').onDelete('CASCADE').notNullable();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('record_id').nullable();
    table.string('triggered_value').nullable();
    table.jsonb('recipients').nullable();
    table.timestamp('sent_at').defaultTo(knex.fn.now());
    table.boolean('success').defaultTo(true);
  });

  // 16. SAVED REPORT BUILDER templates
  await knex.schema.createTable('saved_reports', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.jsonb('filters').defaultTo('[]');
    table.jsonb('fields').defaultTo('[]');
    table.string('sort_field').nullable();
    table.string('sort_dir').defaultTo('asc');
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 17. DATA QUALITY RULES
  await knex.schema.createTable('dq_rules', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('rule_type').notNullable(); // missing_required, range_check, logic_check
    table.integer('instrument_id').references('id').inTable('instruments').onDelete('CASCADE').nullable();
    table.string('field_id').nullable();
    table.string('operator').nullable();
    table.string('value').nullable();
    table.string('severity').defaultTo('warning'); // warning, error
    table.boolean('active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 18. RANDOMISATION SCHEMES
  await knex.schema.createTable('rand_schemes', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('algorithm').defaultTo('block');
    table.integer('block_size').defaultTo(4);
    table.jsonb('stratify_by').defaultTo('[]');
    table.jsonb('arms').notNullable(); // List of treatment arms
    table.jsonb('ratio').defaultTo('[]'); // Allocation ratios
    table.boolean('sealed').defaultTo(false);
    table.integer('created_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 19. RANDOMISATION BLOCKS FOR STRATA AND SEQUENCING
  await knex.schema.createTable('rand_blocks', (table) => {
    table.increments('id').primary();
    table.integer('scheme_id').references('id').inTable('rand_schemes').onDelete('CASCADE').notNullable();
    table.string('strata_key').defaultTo('');
    table.integer('block_number').notNullable();
    table.jsonb('sequence').notNullable(); // Balanced arm allocation array
    table.boolean('used').defaultTo(false);
  });

  // 20. RANDOMISATION ALLOCATIONS PER PARTICIPANT
  await knex.schema.createTable('rand_allocations', (table) => {
    table.increments('id').primary();
    table.integer('scheme_id').references('id').inTable('rand_schemes').onDelete('CASCADE').notNullable();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('record_id').notNullable();
    table.integer('site_id').references('id').inTable('sites').onDelete('SET NULL').nullable();
    table.string('arm').notNullable();
    table.string('strata_key').nullable();
    table.integer('block_number').nullable();
    table.integer('position_in_block').nullable();
    table.timestamp('allocated_at').defaultTo(knex.fn.now());
    table.integer('allocated_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.timestamp('unblinded_at').nullable();
    table.integer('unblinded_by').references('id').inTable('users').onDelete('SET NULL').nullable();
    table.unique(['scheme_id', 'record_id']);
  });

  // 21. OFFLINE SYNC QUEUE
  await knex.schema.createTable('offline_queue', (table) => {
    table.increments('id').primary();
    table.integer('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.string('client_id').notNullable();
    table.string('action').notNullable();
    table.jsonb('payload').notNullable();
    table.boolean('synced').defaultTo(false);
    table.boolean('conflict').defaultTo(false);
    table.text('conflict_detail').nullable();
    table.timestamp('submitted_at').nullable();
    table.timestamp('synced_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

export const down = async function (knex) {
  // Drop tables in reverse dependency order
  await knex.schema.dropTableIfExists('offline_queue');
  await knex.schema.dropTableIfExists('rand_allocations');
  await knex.schema.dropTableIfExists('rand_blocks');
  await knex.schema.dropTableIfExists('rand_schemes');
  await knex.schema.dropTableIfExists('dq_rules');
  await knex.schema.dropTableIfExists('saved_reports');
  await knex.schema.dropTableIfExists('alert_log');
  await knex.schema.dropTableIfExists('alert_rules');
  await knex.schema.dropTableIfExists('dde_records');
  await knex.schema.dropTableIfExists('attachments');
  await knex.schema.dropTableIfExists('patient_events');
  await knex.schema.dropTableIfExists('survey_links');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('project_users');
  await knex.schema.dropTableIfExists('records');
  await knex.schema.dropTableIfExists('event_instruments');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('instruments');
  
  // Break circular user-site dependency
  await knex.schema.table('users', (table) => {
    table.dropForeign('site_id');
  });

  await knex.schema.dropTableIfExists('sites');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('users');
};
