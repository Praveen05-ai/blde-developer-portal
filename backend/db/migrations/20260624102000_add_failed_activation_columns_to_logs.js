export const up = async function (knex) {
  const hasSourceIp = await knex.schema.hasColumn('license_logs', 'source_ip');
  if (!hasSourceIp) {
    await knex.schema.alterTable('license_logs', (table) => {
      table.string('source_ip').nullable();
      table.string('failure_reason').nullable();
      table.string('license_serial').nullable();
    });
  }
};

export const down = async function (knex) {
  await knex.schema.alterTable('license_logs', (table) => {
    table.dropColumn('source_ip');
    table.dropColumn('failure_reason');
    table.dropColumn('license_serial');
  });
};
