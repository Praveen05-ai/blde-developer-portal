export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('license_features');
  if (!hasTable) {
    await knex.schema.createTable('license_features', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().notNullable()
        .references('id').inTable('licenses').onDelete('CASCADE');
      table.boolean('survey_module').notNullable().defaultTo(false);
      table.boolean('api_access').notNullable().defaultTo(false);
      table.boolean('export_excel').notNullable().defaultTo(false);
      table.boolean('export_csv').notNullable().defaultTo(false);
      table.boolean('export_pdf').notNullable().defaultTo(false);
      table.boolean('file_attachments').notNullable().defaultTo(false);
      table.boolean('randomization_module').notNullable().defaultTo(false);
      table.boolean('esignature').notNullable().defaultTo(false);
      table.boolean('notifications').notNullable().defaultTo(false);
      table.boolean('mobile_access').notNullable().defaultTo(false);
      table.boolean('backup_restore').notNullable().defaultTo(false);
      table.boolean('custom_branding').notNullable().defaultTo(false);
      table.timestamps(true, true);
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('license_features');
};
