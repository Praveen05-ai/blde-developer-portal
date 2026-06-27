import knex from 'knex';
import knexConfig from './knexfile.js';

const db = knex(knexConfig.development);

async function main() {
  console.log('🧹 Clearing old demo data...');
  await db('offline_queue').del();
  await db('rand_allocations').del();
  await db('rand_blocks').del();
  await db('rand_schemes').del();
  await db('dq_rules').del();
  await db('data_queries').del();
  await db('records').del();
  await db('event_instruments').del();
  await db('events').del();
  await db('instruments').del();
  await db('project_users').del();
  await db('projects').del();

  console.log('🌱 Seeding fresh demo data...');

  const defaultOrg = await db('organizations').first();
  const orgId = defaultOrg ? defaultOrg.id : 1;

  const researcher = await db('users').where({ email: 'researcher@blde.ac.in' }).first();
  const dataEntry = await db('users').where({ email: 'data_entry@blde.ac.in' }).first();
  const admin = await db('users').where({ email: 'admin@blde.ac.in' }).first();

  if (!researcher || !dataEntry || !admin) {
    console.error('Core users not found. Run baseline seeds first.');
    process.exit(1);
  }

  // 1. Create Demo Project
  const [projectId] = await db('projects').insert({
    id: 1,
    organization_id: orgId,
    created_by: researcher.id,
    title: 'Cancer Registry',
    description: 'National oncology registry mapping demographics, lab outcomes, and long term survivorship follow-ups.',
    department: 'Oncology',
    guide_name: 'Dr. A. Patil',
    project_type: 'Clinical Research Project',
    status: 'active',
    longitudinal: false,
    randomisation_enabled: false,
    multi_site: false,
    dde_enabled: true
  }).returning('id');

  console.log(`Created Project: Cancer Registry (ID: ${projectId})`);

  // Map Data Entry operator to project
  await db('project_users').insert({
    project_id: 1,
    user_id: dataEntry.id,
    can_view: true,
    can_edit: true,
    can_delete: false
  });
  
  await db('project_users').insert({
    project_id: 1,
    user_id: admin.id,
    can_view: true,
    can_edit: true,
    can_delete: true
  });

  // 2. Create Instruments
  const instDemographics = {
    id: 1,
    project_id: 1,
    name: 'Demographics',
    description: 'Participant baseline demographic attributes.',
    fields: JSON.stringify([
      { id: 'full_name', label: 'Full Name', type: 'text', required: true },
      { id: 'age', label: 'Age', type: 'number', required: true, min: 0, max: 120 },
      { id: 'gender', label: 'Gender', type: 'radio', options: ['Male', 'Female'], required: true }
    ]),
    repeating: false,
    status: 'published'
  };

  const instLabData = {
    id: 2,
    project_id: 1,
    name: 'Lab Data',
    description: 'Baseline blood count and oncology biomarkers reports.',
    fields: JSON.stringify([
      { id: 'wbc_count', label: 'WBC Count (10^3/uL)', type: 'number', required: true },
      { id: 'hemoglobin', label: 'Hemoglobin (g/dL)', type: 'number', required: true },
      { id: 'tumor_marker', label: 'Tumor Marker CEA (ng/mL)', type: 'number', required: false }
    ]),
    repeating: false,
    status: 'published'
  };

  const instFollowup = {
    id: 3,
    project_id: 1,
    name: 'Follow-up',
    description: 'Post-intervention survivorship monitoring questionnaire.',
    fields: JSON.stringify([
      { id: 'survival_status', label: 'Survival Status', type: 'radio', options: ['Alive', 'Deceased'], required: true },
      { id: 'relapse_detected', label: 'Relapse Detected', type: 'radio', options: ['Yes', 'No'], required: true },
      { id: 'comments', label: 'Clinical Comments', type: 'text', required: false }
    ]),
    repeating: false,
    status: 'published'
  };

  await db('instruments').insert([instDemographics, instLabData, instFollowup]);
  console.log('Created Instruments: Demographics, Lab Data, Follow-up');

  // P-001: Demographics complete, Lab Data complete, Follow-up complete
  const rec1_demo = await db('records').insert({
    project_id: 1,
    record_id: 'P-001',
    instrument_id: 1,
    status: 'complete',
    data: JSON.stringify({ full_name: 'Jane Smith', age: 45, gender: 'Female' }),
    entered_by: dataEntry.id
  }).returning('id');
  const rec1_lab = await db('records').insert({
    project_id: 1,
    record_id: 'P-001',
    instrument_id: 2,
    status: 'complete',
    data: JSON.stringify({ wbc_count: 5.5, hemoglobin: 13.2, tumor_marker: 1.2 }),
    entered_by: dataEntry.id
  });
  const rec1_follow = await db('records').insert({
    project_id: 1,
    record_id: 'P-001',
    instrument_id: 3,
    status: 'complete',
    data: JSON.stringify({ survival_status: 'Alive', relapse_detected: 'No', comments: 'Doing well.' }),
    entered_by: dataEntry.id
  });

  // P-002: Demographics complete, Lab Data incomplete (partially completed), Follow-up unstarted
  const rec2_demo = await db('records').insert({
    project_id: 1,
    record_id: 'P-002',
    instrument_id: 1,
    status: 'complete',
    data: JSON.stringify({ full_name: 'John Doe', age: 150, gender: 'Male' }), // Age is 150 (out of bounds for range check!)
    entered_by: dataEntry.id
  }).returning('id');
  
  const rec2_demo_id = Array.isArray(rec2_demo) ? (typeof rec2_demo[0] === 'object' ? rec2_demo[0].id : rec2_demo[0]) : rec2_demo;

  const rec2_lab = await db('records').insert({
    project_id: 1,
    record_id: 'P-002',
    instrument_id: 2,
    status: 'incomplete',
    data: JSON.stringify({ wbc_count: 4.8 }), // Missing hemoglobin!
    entered_by: dataEntry.id
  });

  // P-003: Demographics incomplete/draft, Lab Data unstarted, Follow-up unstarted
  const rec3_demo = await db('records').insert({
    project_id: 1,
    record_id: 'P-003',
    instrument_id: 1,
    status: 'incomplete', // Draft
    data: JSON.stringify({ full_name: 'Robert Miller' }),
    entered_by: dataEntry.id
  });

  // P-004: Demographics query active, Lab Data complete, Follow-up complete
  const rec4_demo = await db('records').insert({
    project_id: 1,
    record_id: 'P-004',
    instrument_id: 1,
    status: 'complete',
    data: JSON.stringify({ full_name: 'Alice Cooper', age: 35, gender: 'Female' }),
    entered_by: dataEntry.id
  }).returning('id');

  const rec4_demo_id = Array.isArray(rec4_demo) ? (typeof rec4_demo[0] === 'object' ? rec4_demo[0].id : rec4_demo[0]) : rec4_demo;

  const rec4_lab = await db('records').insert({
    project_id: 1,
    record_id: 'P-004',
    instrument_id: 2,
    status: 'complete',
    data: JSON.stringify({ wbc_count: 6.2, hemoglobin: 14.5 }),
    entered_by: dataEntry.id
  });
  const rec4_follow = await db('records').insert({
    project_id: 1,
    record_id: 'P-004',
    instrument_id: 3,
    status: 'complete',
    data: JSON.stringify({ survival_status: 'Alive', relapse_detected: 'No' }),
    entered_by: dataEntry.id
  });

  console.log('Created Participant Records: P-001, P-002, P-003, P-004');

  // 4. Create Data Quality Rules (to trigger range query on P-002)
  await db('dq_rules').insert({
    project_id: 1,
    name: 'Age Range Check',
    rule_type: 'range_check',
    instrument_id: 1,
    field_id: 'age',
    operator: '>',
    value: '120',
    severity: 'warning'
  });

  // 5. Seed Queries in data_queries table
  // Manual query from Dr. A. Patil (PI) on P-002 age
  await db('data_queries').insert({
    project_id: 1,
    record_id: 'P-002',
    record_db_id: rec2_demo_id,
    instrument_id: 1,
    field_id: 'age',
    query_text: 'Age seems incorrect. Please check records.',
    status: 'open',
    severity: 'warning',
    raised_by: researcher.id,
    created_at: new Date()
  });

  // Query on P-004 demographics raised by system
  await db('data_queries').insert({
    project_id: 1,
    record_id: 'P-004',
    record_db_id: rec4_demo_id,
    instrument_id: 1,
    field_id: 'gender',
    query_text: 'Gender field query mismatch with hospital intake record.',
    status: 'open',
    severity: 'warning',
    raised_by: researcher.id,
    created_at: new Date()
  });

  console.log('Seeded active Queries and Data Quality Rules.');
  console.log('✅ Demo data seeding completed successfully!');
}

main().catch(err => {
  console.error(err);
}).finally(() => {
  db.destroy();
});
