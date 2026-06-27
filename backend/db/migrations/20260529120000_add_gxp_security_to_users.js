export const up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.integer('failed_login_attempts').defaultTo(0);
    table.timestamp('lockout_until').nullable();
    table.timestamp('password_changed_at').nullable();
    table.boolean('force_password_change').defaultTo(false);
    table.jsonb('password_history').defaultTo('[]');
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('failed_login_attempts');
    table.dropColumn('lockout_until');
    table.dropColumn('password_changed_at');
    table.dropColumn('force_password_change');
    table.dropColumn('password_history');
  });
};
