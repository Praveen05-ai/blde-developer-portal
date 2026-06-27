export const up = async function (knex) {
  const hasTable = await knex.schema.hasTable('license_logs');
  if (!hasTable) {
    await knex.schema.createTable('license_logs', (table) => {
      table.increments('id').primary();
      table.integer('license_id').unsigned().notNullable()
        .references('id').inTable('licenses').onDelete('CASCADE');
      table.string('action').notNullable(); // activation, verification, expiration, suspension, revocation, limit_breach
      table.text('details').nullable();
      table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
    });
  }
};

export const down = async function (knex) {
  await knex.schema.dropTableIfExists('license_logs');
};
