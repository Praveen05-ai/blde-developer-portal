export const up = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.string('activation_otp').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('activation_otp');
  });
};
