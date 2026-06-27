export const up = async function (knex) {
  await knex.schema.alterTable('consultation_tickets', (table) => {
    table.text('project_filename').alter();
  });
};

export const down = async function (knex) {
  await knex.schema.alterTable('consultation_tickets', (table) => {
    table.string('project_filename').alter();
  });
};
