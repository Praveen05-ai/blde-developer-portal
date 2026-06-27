export const up = async function (knex) {
  await knex.schema.createTable('data_queries', (table) => {
    table.increments('id').primary();
    table.integer('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.string('record_id').notNullable();
    table.integer('record_db_id').notNullable().references('id').inTable('records').onDelete('CASCADE');
    table.integer('instrument_id').notNullable().references('id').inTable('instruments').onDelete('CASCADE');
    table.string('field_id').notNullable();
    table.text('query_text').notNullable();
    table.string('status').notNullable().defaultTo('open'); // 'open', 'resolved', 'closed'
    table.string('severity').notNullable().defaultTo('warning'); // 'error', 'warning', 'info'
    table.integer('raised_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.integer('resolved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.text('resolution_comment').nullable();
    table.timestamps(true, true);
  });
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('data_queries');
};
