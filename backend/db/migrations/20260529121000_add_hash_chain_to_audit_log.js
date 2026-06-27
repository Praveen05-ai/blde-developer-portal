export const up = async function (knex) {
  await knex.schema.alterTable('audit_log', (table) => {
    table.text('previous_hash').nullable();
    table.text('current_hash').nullable();
    table.string('hostname').nullable();
    table.string('db_mode').nullable();
    table.string('app_version').nullable();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('audit_log', (table) => {
    table.dropColumn('previous_hash');
    table.dropColumn('current_hash');
    table.dropColumn('hostname');
    table.dropColumn('db_mode');
    table.dropColumn('app_version');
  });
};
