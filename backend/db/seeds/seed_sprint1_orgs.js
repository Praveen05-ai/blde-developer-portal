export const seed = async function (knex) {
  // Check if organizations already exist
  const existingOrgs = await knex('organizations').select('id');
  if (existingOrgs.length > 0) {
    console.log('Orgs already exist. Skipping seeding of organizations.');
    return;
  }

  console.log('🌱 Seeding organizations and deployment instances...');

  // 1. Seed Organizations
  const [orgBlde] = await knex('organizations')
    .insert([
      {
        name: 'BLDE Association University',
        organization_type: 'university',
        status: 'active'
      },
      {
        name: 'BLDE Hospital Research',
        organization_type: 'hospital',
        status: 'active'
      },
      {
        name: 'Individual Researcher',
        organization_type: 'individual',
        status: 'active'
      }
    ])
    .returning(['id', 'name', 'organization_type']);

  const defaultOrgId = orgBlde ? orgBlde.id : 1;

  // 2. Link existing users to BLDE Association University organization
  await knex('users').update({ organization_id: defaultOrgId });

  // 3. Seed default deployment_instances for dynamic modes checks
  await knex('deployment_instances').insert([
    {
      organization_id: defaultOrgId,
      deployment_mode: 'saas',
      version: '17.0',
      license_id: 'BLDE-SAAS-0001'
    }
  ]);

  console.log('✅ Seeding organizations and deployment instances complete.');
};
