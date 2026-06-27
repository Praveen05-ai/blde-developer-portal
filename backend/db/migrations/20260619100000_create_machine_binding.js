export const up = async function (knex) {
  const hasMachineHash = await knex.schema.hasColumn('licenses', 'machine_hash');
  if (!hasMachineHash) {
    await knex.schema.alterTable('licenses', (table) => {
      table.string('machine_hash').nullable();
      table.string('machine_binding_status').defaultTo('unbound');
      table.timestamp('binding_date').nullable();
      table.timestamp('last_checkin').nullable();
      table.integer('allowed_machine_changes').defaultTo(1);
      table.integer('machine_change_count').defaultTo(0);
      table.string('fingerprint_version').defaultTo('v1');
    });
  }
};

export const down = async function (knex) {
  const hasMachineHash = await knex.schema.hasColumn('licenses', 'machine_hash');
  if (hasMachineHash) {
    await knex.schema.alterTable('licenses', (table) => {
      table.dropColumn('fingerprint_version');
      table.dropColumn('machine_change_count');
      table.dropColumn('allowed_machine_changes');
      table.dropColumn('last_checkin');
      table.dropColumn('binding_date');
      table.dropColumn('machine_binding_status');
      table.dropColumn('machine_hash');
    });
  }
};
