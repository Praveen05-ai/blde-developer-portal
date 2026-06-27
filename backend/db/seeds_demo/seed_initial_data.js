import bcrypt from 'bcryptjs';

export const seed = async function (knex) {
  // Deletes ALL existing entries in reverse dependency order to prevent constraint violation
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

  // Dialect Detection for Postgres sequence resets
  const isPg = knex.client.config.client === 'pg';
  const resetSeq = async (seq, table) => {
    if (isPg) {
      await knex.raw(`SELECT setval('${seq}', (SELECT MAX(id) FROM ${table}))`);
    }
  };

  // 1. Seed Users
  const hashedPassword = await bcrypt.hash('Admin@123', 10);
  const [adminUser] = await knex('users')
    .insert({
      name: 'BLDE Admin',
      email: 'admin@blde.ac.in',
      password: hashedPassword,
      role: 'admin',
      totp_enabled: false,
      force_password_change: true,
    })
    .returning('*');

  // 2. Seed Projects
  const [project] = await knex('projects')
    .insert({
      id: 1,
      title: 'Cardiac Risk Study 2025',
      description: 'Longitudinal cardiac biomarker RCT',
      status: 'production',
      longitudinal: true,
      randomisation_enabled: true,
      multi_site: true,
      created_by: adminUser.id,
    })
    .returning('*');

  // Reset postgres auto-increment index for projects since we forced id: 1
  await resetSeq('projects_id_seq', 'projects');

  // 3. Seed Sites
  const [site1, site2, site3] = await knex('sites')
    .insert([
      {
        id: 1,
        project_id: project.id,
        name: 'BLDE Medical College',
        code: 'BLDE',
        city: 'Vijayapura',
        pi_name: 'Dr. S. Kumar',
        pi_email: 'skumar@blde.ac.in',
        active: true,
      },
      {
        id: 2,
        project_id: project.id,
        name: 'BLDE-Hubli Centre',
        code: 'BLDE-HBL',
        city: 'Hubli',
        pi_name: 'Dr. R. Patil',
        pi_email: 'rpatil@blde.ac.in',
        active: true,
      },
      {
        id: 3,
        project_id: project.id,
        name: 'BLDE-Belgaum Centre',
        code: 'BLDE-BLG',
        city: 'Belagavi',
        pi_name: 'Dr. M. Shah',
        pi_email: 'mshah@blde.ac.in',
        active: true,
      },
    ])
    .returning('*');

  await resetSeq('sites_id_seq', 'sites');

  // Assign Admin User to Site 1
  await knex('users').where({ id: adminUser.id }).update({ site_id: site1.id });

  // 4. Seed Instruments
  const [inst1, inst2] = await knex('instruments')
    .insert([
      {
        id: 1,
        project_id: project.id,
        name: 'Demographics',
        description: 'Baseline demographics',
        fields: JSON.stringify([
          { id: 'f1', label: 'Patient ID', type: 'text', required: true, validation: { type: 'regex', pattern: '^PT-\\d{3,6}$', message: 'Format: PT-XXXXX' } },
          { id: 'f2', label: 'Date of Enrollment', type: 'date', required: true, validation: { type: 'date', maxToday: true, message: 'Cannot be in the future' } },
          { id: 'f3', label: 'Age (years)', type: 'number', required: true, validation: { type: 'range', min: 18, max: 99, message: 'Must be 18–99' } },
          { id: 'f4', label: 'Sex at Birth', type: 'radio', required: true, options: ['Male', 'Female', 'Intersex', 'Unknown'] },
          { id: 'f5', label: 'Diabetes Type', type: 'radio', required: true, options: ['Type 1', 'Type 2', 'MODY', 'Unknown'] },
          { id: 'f6', label: 'Height (cm)', type: 'number', validation: { type: 'range', min: 100, max: 250, message: 'Must be 100–250' } },
          { id: 'f7', label: 'Weight (kg)', type: 'number', validation: { type: 'range', min: 20, max: 300, message: 'Must be 20–300' } },
          { id: 'f8', label: 'BMI', type: 'calc', formula: 'f7/((f6/100)*(f6/100))', formulaDisplay: 'Weight÷(Height/100)²', decimalPlaces: 1 },
          { id: 'f9', label: 'Consent Document', type: 'file', accept: '.pdf,.jpg,.png' },
          { id: 'f10', label: 'Notes', type: 'textarea' },
        ]),
        repeating: false,
      },
      {
        id: 2,
        project_id: project.id,
        name: 'Lab Results',
        description: 'Blood work per visit',
        fields: JSON.stringify([
          { id: 'g1', label: 'Visit Date', type: 'date', required: true, validation: { type: 'date', maxToday: true } },
          { id: 'g2', label: 'HbA1c (%)', type: 'number', required: true, validation: { type: 'range', min: 3, max: 20, message: 'Must be 3–20%' } },
          { id: 'g3', label: 'Fasting Glucose (mg/dL)', type: 'number', validation: { type: 'range', min: 40, max: 600 } },
          { id: 'g4', label: 'LDL (mg/dL)', type: 'number', validation: { type: 'range', min: 20, max: 400 } },
          { id: 'g5', label: 'HDL (mg/dL)', type: 'number', validation: { type: 'range', min: 10, max: 150 } },
          { id: 'g6', label: 'Total Cholesterol', type: 'calc', formula: 'g4+g5', formulaDisplay: 'LDL+HDL', decimalPlaces: 0 },
          { id: 'g7', label: 'Serious Adverse Event', type: 'radio', required: true, options: ['Yes', 'No'] },
          { id: 'g8', label: 'SAE Description', type: 'textarea', branching: { field: 'g7', operator: '=', value: 'Yes', action: 'show' } },
          { id: 'g9', label: 'Lab Report PDF', type: 'file', accept: '.pdf' },
        ]),
        repeating: true,
      },
    ])
    .returning('*');

  await resetSeq('instruments_id_seq', 'instruments');

  // 5. Seed Events
  const [e1, e2, e3, e4, e5] = await knex('events')
    .insert([
      { id: 1, project_id: project.id, name: 'Baseline', day_offset: 0, window_before: 0, window_after: 3, description: 'Enrollment visit', sort_order: 1 },
      { id: 2, project_id: project.id, name: 'Week 4', day_offset: 28, window_before: 3, window_after: 3, description: 'First follow-up', sort_order: 2 },
      { id: 3, project_id: project.id, name: 'Week 12', day_offset: 84, window_before: 5, window_after: 5, description: 'Primary endpoint', sort_order: 3 },
      { id: 4, project_id: project.id, name: '6-Month', day_offset: 180, window_before: 7, window_after: 7, description: 'Secondary endpoint', sort_order: 4 },
      { id: 5, project_id: project.id, name: '12-Month', day_offset: 365, window_before: 14, window_after: 14, description: 'Final visit', sort_order: 5 },
    ])
    .returning('*');

  await resetSeq('events_id_seq', 'events');

  // 6. Seed Event Instruments
  await knex('event_instruments').insert([
    { event_id: e1.id, instrument_id: inst1.id, required: true },
    { event_id: e1.id, instrument_id: inst2.id, required: true },
    { event_id: e2.id, instrument_id: inst2.id, required: true },
    { event_id: e3.id, instrument_id: inst2.id, required: true },
    { event_id: e4.id, instrument_id: inst2.id, required: true },
    { event_id: e5.id, instrument_id: inst2.id, required: true },
  ]);

  // 7. Seed Randomisation Schemes
  await knex('rand_schemes').insert({
    id: 1,
    project_id: project.id,
    name: 'Drug vs Placebo (1:1)',
    description: 'Block randomisation stratified by site and diabetes type',
    algorithm: 'block',
    block_size: 4,
    stratify_by: JSON.stringify(['site', 'f5']),
    arms: JSON.stringify(['Drug (Active)', 'Placebo']),
    ratio: JSON.stringify([1, 1]),
    sealed: false,
    created_by: adminUser.id,
  });

  await resetSeq('rand_schemes_id_seq', 'rand_schemes');

  // 8. Seed Alert Rules
  await knex('alert_rules').insert({
    id: 1,
    project_id: project.id,
    name: 'SAE Alert',
    instrument_id: inst2.id,
    trigger_field: 'g7',
    trigger_operator: '=',
    trigger_value: 'Yes',
    alert_type: 'email',
    recipients: JSON.stringify(['admin@blde.ac.in']),
    subject: '⚠ SAE — {record_id}',
    message: 'SAE reported for {record_id}. Value: {value}',
    active: true,
    created_by: adminUser.id,
  });

  await resetSeq('alert_rules_id_seq', 'alert_rules');

  // 9. Seed DQ Rules
  await knex('dq_rules').insert([
    {
      id: 1,
      project_id: project.id,
      name: 'Missing HbA1c',
      description: 'Required lab value',
      rule_type: 'missing_required',
      instrument_id: inst2.id,
      field_id: 'g2',
      severity: 'error',
      active: true,
    },
    {
      id: 2,
      project_id: project.id,
      name: 'High HbA1c',
      description: 'Needs review',
      rule_type: 'range_check',
      instrument_id: inst2.id,
      field_id: 'g2',
      operator: '>',
      value: '10',
      severity: 'warning',
      active: true,
    },
    {
      id: 3,
      project_id: project.id,
      name: 'Stale Incomplete',
      description: 'Old incomplete records',
      rule_type: 'stale_incomplete',
      operator: '7',
      severity: 'warning',
      active: true,
    },
  ]);

  await resetSeq('dq_rules_id_seq', 'dq_rules');
};
