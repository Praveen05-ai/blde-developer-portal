export const up = async function (knex) {
  // 1. Alter Table: licenses (Add Phase 6 fields)
  const hasVerEnabled = await knex.schema.hasColumn('licenses', 'verification_enabled');
  if (!hasVerEnabled) {
    await knex.schema.alterTable('licenses', (table) => {
      table.boolean('verification_enabled').defaultTo(false);
      table.timestamp('last_server_check').nullable();
      table.timestamp('next_server_check').nullable();
      table.integer('offline_grace_days').defaultTo(30);
      table.text('last_server_response').nullable();
      table.string('verification_server_url').nullable();
      table.string('backup_verification_server_url').nullable();
      table.string('remote_status').defaultTo('active');
      table.text('remote_status_reason').nullable();
      table.integer('verification_fail_count').defaultTo(0);
      table.boolean('emergency_override').defaultTo(false);
      table.timestamp('override_until').nullable();
    });
  }

  // 2. Create Table: license_server_logs
  const hasServerLogs = await knex.schema.hasTable('license_server_logs');
  if (!hasServerLogs) {
    await knex.schema.createTable('license_server_logs', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().references('id').inTable('licenses').onDelete('CASCADE').nullable();
      table.text('license_key').notNullable();
      table.string('machine_hash').notNullable();
      table.string('request_type').notNullable();
      table.string('response_status').notNullable();
      table.text('response_message').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 3. Create Table: verification_cache
  const hasVerCache = await knex.schema.hasTable('verification_cache');
  if (!hasVerCache) {
    await knex.schema.createTable('verification_cache', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().references('id').inTable('licenses').onDelete('CASCADE').notNullable();
      table.text('cached_payload').notNullable();
      table.string('signature').notNullable();
      table.string('status').notNullable();
      table.timestamp('timestamp').notNullable();
    });
  }

  // 4. Create Table: license_heartbeat_history
  const hasHbHistory = await knex.schema.hasTable('license_heartbeat_history');
  if (!hasHbHistory) {
    await knex.schema.createTable('license_heartbeat_history', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().references('id').inTable('licenses').onDelete('CASCADE').notNullable();
      table.string('machine_hash').notNullable();
      table.timestamp('request_time').notNullable();
      table.timestamp('response_time').notNullable();
      table.string('status').notNullable();
      table.integer('latency').notNullable(); // in ms
      table.string('server_used').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 5. Create Table: license_remote_commands
  const hasRemoteCmds = await knex.schema.hasTable('license_remote_commands');
  if (!hasRemoteCmds) {
    await knex.schema.createTable('license_remote_commands', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().references('id').inTable('licenses').onDelete('CASCADE').notNullable();
      table.string('command').notNullable(); // warn, suspend, revoke, force_verify, reset_machine
      table.string('issued_by').nullable();
      table.timestamp('executed_at').nullable();
      table.string('status').defaultTo('pending'); // pending, success, failure
      table.text('notes').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  // 6. Create Table: used_nonces
  const hasUsedNonces = await knex.schema.hasTable('used_nonces');
  if (!hasUsedNonces) {
    await knex.schema.createTable('used_nonces', (table) => {
      table.increments('id').primary();
      table.string('nonce').unique().notNullable();
      table.timestamp('expires_at').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('used_nonces');
  await knex.schema.dropTableIfExists('license_remote_commands');
  await knex.schema.dropTableIfExists('license_heartbeat_history');
  await knex.schema.dropTableIfExists('verification_cache');
  await knex.schema.dropTableIfExists('license_server_logs');

  const hasVerEnabled = await knex.schema.hasColumn('licenses', 'verification_enabled');
  if (hasVerEnabled) {
    await knex.schema.alterTable('licenses', (table) => {
      table.dropColumn('override_until');
      table.dropColumn('emergency_override');
      table.dropColumn('verification_fail_count');
      table.dropColumn('remote_status_reason');
      table.dropColumn('remote_status');
      table.dropColumn('backup_verification_server_url');
      table.dropColumn('verification_server_url');
      table.dropColumn('last_server_response');
      table.dropColumn('offline_grace_days');
      table.dropColumn('next_server_check');
      table.dropColumn('last_server_check');
      table.dropColumn('verification_enabled');
    });
  }
};
