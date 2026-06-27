import bcrypt from 'bcryptjs';

export const seed = async function (knex) {
  console.log('🧹 Cleaning existing database data for core baseline setup...');
  
  const isPg = knex.client.config.client === 'pg';
  if (isPg) {
    await knex.raw("SET blde.disable_audit_triggers = 'true'");
  }
  
  // Deletes ALL existing entries in reverse dependency order to prevent constraint violations
  await knex('offline_queue').del();
  await knex('rand_allocations').del();
  await knex('rand_blocks').del();
  await knex('rand_schemes').del();
  await knex('dq_rules').del();
  await knex('saved_reports').del();
  await knex('alert_log').del();
  await knex('alert_rules').del();
  await knex('dde_records').del();
  await knex('attachments').del();
  await knex('patient_events').del();
  await knex('survey_links').del();
  await knex('audit_log').del();
  await knex('project_users').del();
  await knex('records').del();
  await knex('event_instruments').del();
  await knex('events').del();
  await knex('instruments').del();

  // Clear foreign site dependency
  await knex('users').update({ site_id: null });
  await knex('sites').del();
  await knex('projects').del();
  await knex('users').del();
  await knex('consultants').del();

  // Dialect Detection for Postgres sequence resets
  const resetSeq = async (seq, table) => {
    if (isPg) {
      await knex.raw(`SELECT setval('${seq}', (SELECT MAX(id) FROM ${table}))`);
    }
  };

  // 1. Seed Core Admin Users (Only in development/testing, NOT in production)
  if (process.env.NODE_ENV !== 'production') {
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);
    const hashedResearcherPassword = bcrypt.hashSync('Test@123', 10);
    await knex('users')
      .insert([
        {
          name: 'BLDE Dev Admin',
          email: 'devadmin@blde.ac.in',
          password: hashedPassword,
          role: 'admin',
          totp_enabled: false,
          force_password_change: false,
        },
        {
          name: 'BLDE Researcher',
          email: 'researcher@blde.ac.in',
          password: hashedResearcherPassword,
          role: 'pi',
          totp_enabled: false,
          force_password_change: false,
        },
        {
          name: 'BLDE Data Entry',
          email: 'data_entry@blde.ac.in',
          password: hashedResearcherPassword,
          role: 'data_entry',
          totp_enabled: false,
          force_password_change: false,
        }
      ]);
  }

  // 2. Seed Default Consultants for Research Assistant Platform
  const consultants = [
    { name: 'Dr. Sharan Patil', email: 'patil.sharan@blde.ac.in', role: 'consultant', active: true },
    { name: 'Prof. Anita G.', email: 'anita.g@blde.ac.in', role: 'statistician', active: true },
    { name: 'Dr. Suresh K.', email: 'suresh.k@blde.ac.in', role: 'ai_engineer', active: true },
    { name: 'Amit Kumar', email: 'kumar.amit@blde.ac.in', role: 'db_operator', active: true },
    { name: 'Vani K.', email: 'vani.k@blde.ac.in', role: 'qa', active: true }
  ];
  await knex('consultants').insert(consultants);

  console.log('✅ Baseline GxP database initialized with Admin credentials and default consultants.');
};
