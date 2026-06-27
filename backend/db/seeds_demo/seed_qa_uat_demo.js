import bcrypt from 'bcryptjs';

export const seed = async function (knex) {
  console.log('🌱 Starting QA/UAT Sandbox Seeding...');

  // Hash standard password for sandbox users
  const hashedPw = await bcrypt.hash('Sandbox@123', 10);

  // 1. Create or Find Sandbox Project
  let [sandboxProj] = await knex('projects')
    .where({ title: '🏥 QA/UAT Sandbox & Verification Project 2026' })
    .select('*');

  if (sandboxProj) {
    console.log('🧹 Cleaning existing sandbox project data...');
    // Cascade constraints will clean related data, but let us delete cleanly
    await knex('projects').where({ id: sandboxProj.id }).del();
  }

  // Insert fresh sandbox project
  [sandboxProj] = await knex('projects')
    .insert({
      title: '🏥 QA/UAT Sandbox & Verification Project 2026',
      description: 'Fully featured, pre-populated sandbox project for Quality Assurance and UAT feature verification.',
      status: 'development',
      longitudinal: true,
      randomisation_enabled: true,
      multi_site: true,
    })
    .returning('*');

  console.log(`✅ Sandbox Project created: ID ${sandboxProj.id}`);

  // 2. Create Sandboxed Sites
  const [siteHBL, siteBGK] = await knex('sites')
    .insert([
      {
        project_id: sandboxProj.id,
        name: 'QA Sandbox Hubli Clinic',
        code: 'QA-HBL',
        city: 'Hubli',
        pi_name: 'Dr. Ramesh Patil',
        pi_email: 'rpatil@blde.ac.in',
        active: true,
      },
      {
        project_id: sandboxProj.id,
        name: 'QA Sandbox Bagalkot Clinic',
        code: 'QA-BGK',
        city: 'Bagalkot',
        pi_name: 'Dr. Anita Desai',
        pi_email: 'adesai@blde.ac.in',
        active: true,
      }
    ])
    .returning('*');

  console.log(`✅ Sandboxed Sites created: QA-HBL (ID ${siteHBL.id}) and QA-BGK (ID ${siteBGK.id})`);

  // 3. Create Sandbox Users
  // Deleting existing sandbox users to prevent unique constraint conflict
  await knex('users').whereIn('email', ['qa_researcher@blde.ac.in', 'qa_operator@blde.ac.in']).del();

  const [resUser] = await knex('users')
    .insert({
      name: 'QA Hubli Researcher',
      email: 'qa_researcher@blde.ac.in',
      password: hashedPw,
      role: 'researcher',
      site_id: siteHBL.id,
      totp_enabled: false,
    })
    .returning('*');

  const [opUser] = await knex('users')
    .insert({
      name: 'QA Bagalkot Operator',
      email: 'qa_operator@blde.ac.in',
      password: hashedPw,
      role: 'data_entry',
      site_id: siteBGK.id,
      totp_enabled: false,
    })
    .returning('*');

  console.log('✅ Sandbox Users created: qa_researcher@blde.ac.in and qa_operator@blde.ac.in (Password: Sandbox@123)');

  // 4. Grant Project-level Permissions
  await knex('project_users').insert([
    {
      project_id: sandboxProj.id,
      user_id: resUser.id,
      can_view: true,
      can_edit: true,
      can_delete: false,
      can_export: true,
      can_manage: false,
    },
    {
      project_id: sandboxProj.id,
      user_id: opUser.id,
      can_view: true,
      can_edit: true,
      can_delete: false,
      can_export: false, // Operator blocked from CSV downloads
      can_manage: false,
    }
  ]);
  console.log('✅ Sandbox project-user permissions mapped.');

  // 5. Create Sandboxed Instruments (CRFs)
  const [instDemog, instVitals, instDraft] = await knex('instruments')
    .insert([
      {
        project_id: sandboxProj.id,
        name: 'Sandbox Demographics',
        description: 'Baseline demographic characteristics & consent',
        status: 'published',
        fields: JSON.stringify([
          { id: 'sb_pat_id', label: 'Patient Record ID', type: 'text', required: true },
          { id: 'sb_age', label: 'Age (Years)', type: 'number', required: true, validation: { type: 'range', min: 18, max: 99, message: 'Age must be 18 to 99' } },
          { id: 'sb_gender', label: 'Gender', type: 'radio', required: true, options: ['Male', 'Female', 'Other'] },
          { id: 'sb_height', label: 'Height (cm)', type: 'number', required: true, validation: { type: 'range', min: 100, max: 250 } },
          { id: 'sb_weight', label: 'Weight (kg)', type: 'number', required: true, validation: { type: 'range', min: 30, max: 200 } },
          { id: 'sb_bmi', label: 'Calculated BMI', type: 'calc', decimalPlaces: 1, formula: 'sb_weight/((sb_height/100)*(sb_height/100))', formulaDisplay: 'Weight ÷ (Height/100)²' },
          { id: 'sb_consent_pdf', label: 'Consent Document PDF', type: 'file', accept: '.pdf' }
        ]),
        repeating: false,
      },
      {
        project_id: sandboxProj.id,
        name: 'Sandbox Clinical Vitals',
        description: 'Scheduled follow-up vitals log',
        status: 'published',
        fields: JSON.stringify([
          { id: 'sb_sys_bp', label: 'Systolic BP (mmHg)', type: 'number', required: true, validation: { type: 'range', min: 80, max: 220, message: 'Must be between 80 and 220' } },
          { id: 'sb_temp', label: 'Temperature (°C)', type: 'number', required: true, validation: { type: 'range', min: 35, max: 42, message: 'Must be between 35.0 and 42.0' } },
          { id: 'sb_sae_event', label: 'Serious Adverse Event?', type: 'radio', required: true, options: ['Yes', 'No'] },
          { id: 'sb_sae_details', label: 'SAE Clinical Description', type: 'textarea', required: false, branching: { field: 'sb_sae_event', operator: '=', value: 'Yes', action: 'show' } }
        ]),
        repeating: true,
      },
      {
        project_id: sandboxProj.id,
        name: 'Sandbox Biomarker Draft',
        description: 'Biomarkers tracking CRF (DRAFT - Used to test Publish & Seal)',
        status: 'draft',
        fields: JSON.stringify([
          { id: 'sb_hba1c', label: 'HbA1c (%)', type: 'number', required: true },
          { id: 'sb_cholesterol', label: 'Total Cholesterol (mg/dL)', type: 'number', required: false }
        ]),
        repeating: false,
      }
    ])
    .returning('*');

  console.log('✅ Sandbox Instruments created (2 Published, 1 Draft).');

  // 6. Create Sandboxed Events (Longitudinal scheduling)
  const [eventBase, eventM1, eventM6] = await knex('events')
    .insert([
      { project_id: sandboxProj.id, name: 'UAT Baseline Visit', day_offset: 0, window_before: 0, window_after: 3, sort_order: 1 },
      { project_id: sandboxProj.id, name: 'UAT Month 1 Visit', day_offset: 30, window_before: 3, window_after: 3, sort_order: 2 },
      { project_id: sandboxProj.id, name: 'UAT Month 6 Visit', day_offset: 180, window_before: 7, window_after: 7, sort_order: 3 }
    ])
    .returning('*');

  // Link Instruments to Events
  await knex('event_instruments').insert([
    { event_id: eventBase.id, instrument_id: instDemog.id, required: true },
    { event_id: eventBase.id, instrument_id: instVitals.id, required: true },
    { event_id: eventM1.id, instrument_id: instVitals.id, required: true },
    { event_id: eventM6.id, instrument_id: instVitals.id, required: true }
  ]);
  console.log('✅ Sandbox Events & schedules linked.');

  // 7. Create Pre-Populated Clinical Records
  // Record 1: Hubli, Locked and Signed
  const [recHBL] = await knex('records')
    .insert({
      project_id: sandboxProj.id,
      instrument_id: instDemog.id,
      record_id: 'QA-PT-001',
      site_id: siteHBL.id,
      event_id: eventBase.id,
      repeat_instance: 1,
      status: 'complete',
      locked: true,
      locked_by: resUser.id,
      locked_at: new Date(),
      lock_signature: 'Verified by Sandbox Researcher',
      entered_by: resUser.id,
      data: JSON.stringify({
        sb_pat_id: 'QA-PT-001',
        sb_age: 45,
        sb_gender: 'Male',
        sb_height: 172,
        sb_weight: 78,
        sb_bmi: 26.4
      })
    })
    .returning('*');

  // Record 2: Bagalkot, Incomplete & Unlocked (ready for operator testing)
  const [recBGK] = await knex('records')
    .insert({
      project_id: sandboxProj.id,
      instrument_id: instDemog.id,
      record_id: 'QA-PT-002',
      site_id: siteBGK.id,
      event_id: eventBase.id,
      repeat_instance: 1,
      status: 'incomplete',
      locked: false,
      entered_by: opUser.id,
      data: JSON.stringify({
        sb_pat_id: 'QA-PT-002',
        sb_age: 32,
        sb_gender: 'Female',
        sb_height: 160,
        sb_weight: 55,
        sb_bmi: 21.5
      })
    })
    .returning('*');

  console.log('✅ Pre-populated Clinical Records created (1 Locked, 1 Open).');

  // 8. Create Double Data Entry (DDE) Sandbox Case
  // Operator 1 Record (Primary)
  const [ddePrimary] = await knex('records')
    .insert({
      project_id: sandboxProj.id,
      instrument_id: instVitals.id,
      record_id: 'QA-PT-003',
      site_id: siteBGK.id,
      event_id: eventBase.id,
      repeat_instance: 1,
      status: 'complete',
      entered_by: opUser.id,
      data: JSON.stringify({
        sb_sys_bp: 120,
        sb_temp: 37.5, // 37.5 entered by Operator 1
        sb_sae_event: 'No'
      })
    })
    .returning('*');

  // Operator 2 DDE Record (with discrepancies in Temperature)
  await knex('dde_records').insert({
    project_id: sandboxProj.id,
    instrument_id: instVitals.id,
    record_id: 'QA-PT-003',
    primary_record_id: ddePrimary.id,
    status: 'conflict',
    entered_by: resUser.id,
    data: JSON.stringify({
      sb_sys_bp: 120,
      sb_temp: 39.1, // 39.1 entered by Operator 2 (Discrepancy!)
      sb_sae_event: 'No'
    }),
    discrepancies: JSON.stringify([
      { field: 'sb_temp', val1: '37.5', val2: '39.1', message: 'Values do not match' }
    ]),
    resolved: false
  });
  console.log('✅ Sandboxed DDE comparison cases established.');

  // 9. Seed Sandboxed Alert Rules
  const [alertRule] = await knex('alert_rules')
    .insert({
      project_id: sandboxProj.id,
      name: 'High BP Warning Alert',
      instrument_id: instVitals.id,
      trigger_field: 'sb_sys_bp',
      trigger_operator: '>',
      trigger_value: '140',
      alert_type: 'email',
      recipients: JSON.stringify(['supervisor@blde.ac.in']),
      subject: '⚠ Clinical Alert: High Systolic BP for {record_id}',
      message: 'A systolic blood pressure of {value} mmHg was entered for participant {record_id} at site {site_code}. Please review immediately.',
      active: true,
      created_by: resUser.id
    })
    .returning('*');

  console.log('✅ Sandboxed active Alert rules seeded.');

  // 10. Seed Sandboxed Data Quality Rules
  await knex('dq_rules').insert([
    {
      project_id: sandboxProj.id,
      name: 'Missing Demographic Age',
      description: 'Assures that demographic assessments capture the age variable.',
      rule_type: 'missing_required',
      instrument_id: instDemog.id,
      field_id: 'sb_age',
      severity: 'error',
      active: true,
    },
    {
      project_id: sandboxProj.id,
      name: 'High Temperature Limit',
      description: 'Checks for patients with active fevers above 38.5 °C.',
      rule_type: 'range_check',
      instrument_id: instVitals.id,
      field_id: 'sb_temp',
      operator: '>',
      value: '38.5',
      severity: 'warning',
      active: true,
    }
  ]);
  console.log('✅ Sandboxed Data Quality rules seeded.');

  // 11. Seed Pre-configured Saved Reports
  await knex('saved_reports').insert({
    project_id: sandboxProj.id,
    name: 'Hubli Complete Patient Log',
    filters: JSON.stringify([
      { field: 'sb_pat_id', operator: 'contains', value: 'QA' }
    ]),
    created_by: resUser.id
  });
  console.log('✅ Sandboxed custom Report templates seeded.');

  console.log('🏁 QA/UAT Sandbox Seeding completed successfully!');
};
