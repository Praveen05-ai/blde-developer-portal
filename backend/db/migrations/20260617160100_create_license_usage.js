export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('license_usage');
  if (!hasTable) {
    await knex.schema.createTable('license_usage', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().notNullable()
        .references('id').inTable('licenses').onDelete('CASCADE');
      table.integer('max_projects').nullable(); // null for unlimited
      table.integer('max_users').nullable();
      table.integer('max_forms').nullable();
      table.integer('max_records').nullable();
      table.integer('max_storage_gb').nullable();
      table.integer('max_upload_size_mb').nullable();
      table.integer('max_sessions').nullable();
      table.timestamps(true, true);
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('license_usage');
};
