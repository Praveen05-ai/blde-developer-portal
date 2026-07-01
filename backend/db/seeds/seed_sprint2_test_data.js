export const seed = async function (knex) {
  // Check if data is already seeded
  const existingBps = await knex('blueprint_requests').select('id');
  if (existingBps.length > 0) {
    console.log('Sprint 2 sample test data already seeded. Skipping.');
    return;
  }

  console.log('🌱 Seeding Sprint 2 sample test data...');

  // 1. Get default organization and users
  const defaultOrg = await knex('organizations').where({ name: 'BLDE Association University' }).first();
  const orgId = defaultOrg ? defaultOrg.id : 1;

  const researcher = await knex('users').where({ email: 'researcher@blde.ac.in' }).first();
  const admin = await knex('users').where({ email: 'devadmin@blde.ac.in' }).first();

  if (!researcher || !admin) {
    console.warn('⚠️ Researcher or Admin user not found. Please run baseline seeds first.');
    return;
  }

  // 2. Insert sample projects
  const [projAsthma] = await knex('projects')
    .insert([
      {
        organization_id: orgId,
        created_by: researcher.id,
        title: 'Pediatric Asthma Treatment Efficacy Trial',
        description: 'Multi-centre longitudinal clinical trial tracking inhaled corticosteroid response in school children.',
        department: 'Pediatrics',
        guide_name: 'Dr. A. B. Patil',
        project_type: 'Clinical Research Project',
        status: 'active',
        longitudinal: true,
        randomisation_enabled: true,
        multi_site: true,
        dde_enabled: true
      }
    ])
    .returning(['id', 'title']);

  const [projAI] = await knex('projects')
    .insert([
      {
        organization_id: orgId,
        created_by: researcher.id,
        title: 'AI Diabetic Retinopathy Diagnostics Model',
        description: 'Development and validation of deep learning classifier for automated diabetic retinopathy classification.',
        department: 'Ophthalmology',
        guide_name: 'Dr. S. Kumar',
        project_type: 'AI Medical Project',
        status: 'active',
        longitudinal: false,
        randomisation_enabled: false,
        multi_site: false,
        dde_enabled: true
      }
    ])
    .returning(['id', 'title']);

  const asthmaProjId = projAsthma ? projAsthma.id : 1;
  const aiProjId = projAI ? projAI.id : 2;

  // 3. Insert blueprint requests
  const [bpAsthma] = await knex('blueprint_requests')
    .insert([
      {
        organization_id: orgId,
        project_id: asthmaProjId,
        submitted_by: researcher.id,
        title: 'Asthma Efficacy CRF & Metadata Blueprint',
        template_type: 'Clinical Research Project',
        requirements: 'Requesting CRF schema for pediatric patient intake, including FEV1/FVC spirometry parameters, symptoms frequency tracker (repeating form), and drug dosage arms.',
        status: 'under_review',
        assigned_staff_id: admin.id
      }
    ])
    .returning(['id']);

  const [bpAI] = await knex('blueprint_requests')
    .insert([
      {
        organization_id: orgId,
        project_id: aiProjId,
        submitted_by: researcher.id,
        title: 'Retinopathy Fundus Image Annotation Schema',
        template_type: 'AI Medical Project',
        requirements: 'Requesting structural annotation schema and quality check attributes for fundus image uploads (macula centering, optic disc clearance, severity grading 0-4).',
        status: 'ready_for_delivery',
        assigned_staff_id: admin.id
      }
    ])
    .returning(['id']);

  const bpAsthmaId = bpAsthma ? bpAsthma.id : 1;
  const bpAIId = bpAI ? bpAI.id : 2;

  // Update delivered requirements with a sample markdown deliverable for the AI Blueprint
  await knex('blueprint_requests')
    .where({ id: bpAIId })
    .update({
      requirements: `## Fundus Image Annotation Schema Blueprint

Approved by BLDE Biostatisticians for AI Model Training.

### 1. Data Schema Definition
| Field ID | Variable Name | Type | Options / Formats | Required |
|---|---|---|---|---|
| f1_id | Image Reference ID | Text | Unique PT-XXXXX-L/R | Yes |
| f2_dr_grade | Retinopathy Grade | Dropdown | 0: Normal, 1: Mild, 2: Moderate, 3: Severe, 4: Proliferative | Yes |
| f3_macula | Macula Centered | Radio | 1: Yes, 0: No | Yes |
| f4_optic_disc | Optic Disc Clear | Radio | 1: Yes, 0: No | Yes |
| f5_exudates | Hard Exudates Present | Radio | 1: Yes, 0: No | Yes |

> [!NOTE]
> All fundus image uploads must be in DICOM (.dcm) or lossless TIFF format. JPG compression is forbidden.

> [!IMPORTANT]
> The database operator has configured a double-blind random check rule where 10% of images are automatically assigned to double entry validation.`
    });

  // 4. Insert package requests
  const [pkgAsthma] = await knex('package_requests')
    .insert([
      {
        organization_id: orgId,
        project_id: asthmaProjId,
        requested_by: researcher.id,
        requirements: 'Requesting standalone SQLite installer configuration for local clinic tablets to allow offline spirometry records collection.',
        status: 'development',
        assigned_staff_id: admin.id
      }
    ])
    .returning(['id']);

  const pkgAsthmaId = pkgAsthma ? pkgAsthma.id : 1;

  // 5. Insert support tickets
  const [ticketDDE] = await knex('support_tickets')
    .insert([
      {
        organization_id: orgId,
        created_by: researcher.id,
        title: 'Unable to submit Double Data Entry resolution',
        description: 'Getting "Constraint violation: project_id mismatch" error when trying to resolve discrepancies for patient record PT-0042.',
        priority: 'high',
        status: 'open'
      }
    ])
    .returning(['id']);

  const ticketDDEId = ticketDDE ? ticketDDE.id : 1;

  // 6. Insert communication messages
  await knex('communications').insert([
    // Asthma Blueprint discussion
    {
      organization_id: orgId,
      related_type: 'blueprint',
      related_id: bpAsthmaId,
      sender_id: researcher.id,
      message: 'Hi support team, I have submitted the requirements for the Asthma CRF. We plan to start patient onboarding next week, so an early review is appreciated.'
    },
    {
      organization_id: orgId,
      related_type: 'blueprint',
      related_id: bpAsthmaId,
      sender_id: admin.id,
      message: 'Hello! I have assigned Dr. Patil as the Lead Specialist. We are reviewing the FEV1 parameters to ensure they align with GCP standards. We will deliver the blueprint by tomorrow.'
    },
    
    // Ticket DDE discussion
    {
      organization_id: orgId,
      related_type: 'ticket',
      related_id: ticketDDEId,
      sender_id: researcher.id,
      message: 'Here is a screenshot of the DDE console where the conflict resolution fails.'
    },
    {
      organization_id: orgId,
      related_type: 'ticket',
      related_id: ticketDDEId,
      sender_id: admin.id,
      message: 'Thank you for reporting. This is a known tenancy routing bug when resolving site-level conflicts in University mode. I am investigating the DB transaction scopes now.'
    }
  ]);

  console.log('✅ Sprint 2 sample test data seeded successfully.');
};
