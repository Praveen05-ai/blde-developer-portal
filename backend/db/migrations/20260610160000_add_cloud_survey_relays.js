export const up = async function (knex) {
  // Create cloud_surveys table
  await knex.schema.createTable('cloud_surveys', (table) => {
    table.increments('id').primary();
    table.string('client_license_id').notNullable();
    table.integer('client_local_survey_id').notNullable();
    table.string('survey_token').unique().notNullable();
    table.string('project_title').nullable();
    table.string('instrument_name').nullable();
    table.text('schema_json').nullable();
    table.boolean('active').defaultTo(true);
    table.timestamps(true, true);
  });

  // Create cloud_survey_responses table
  await knex.schema.createTable('cloud_survey_responses', (table) => {
    table.increments('id').primary();
    table.string('survey_token').notNullable().references('survey_token').inTable('cloud_surveys').onDelete('CASCADE');
    table.text('response_data').nullable();
    table.boolean('synced').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('cloud_survey_responses');
  await knex.schema.dropTableIfExists('cloud_surveys');
};
