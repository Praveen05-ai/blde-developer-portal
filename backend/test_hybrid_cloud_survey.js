import db from './src/db/connection.js';
import { env } from './src/config/env.js';
import app from './src/app.js';
import { syncEntityToCentral, pullSurveyResponsesFromCentral } from './src/services/syncManager.js';
import crypto from 'crypto';

const runTest = async () => {
  console.log('🏁 Starting E2E Hybrid Cloud Survey Sync Test...');
  let server;

  try {
    // 1. Configure for local network loopback
    env.centralSupportUrl = 'http://127.0.0.1:3002';
    env.licenseKey = 'BLDE-TEST-LICENSE-999';
    env.deploymentMode = 'standalone'; // Act as client initially

    server = app.listen(3002, () => {
      console.log('📡 Mock Central Platform Server listening on port 3002');
    });

    // Clean up tables
    await db('cloud_survey_responses').del();
    await db('cloud_surveys').del();
    await db('survey_links').del();
    await db('records').del();
    await db('audit_log').del();
    await db('instruments').del();
    await db('projects').del();
    await db('users').del();
    await db('organizations').del();

    // 2. Seed project, user, and instrument
    await db('organizations').insert({ id: 1, name: 'BLDE Association', organization_type: 'university', status: 'active' });
    await db('users').insert({ id: 1, name: 'Admin', email: 'admin@blde.ac.in', password: 'hashedpassword', role: 'admin', organization_id: 1 });
    await db('projects').insert({ id: 1, title: 'Cardiology Registry', organization_id: 1, deleted: false, created_by: 1 });
    
    const fields = [
      { id: 'age', label: 'Age', type: 'number', required: true },
      { id: 'symptoms', label: 'Symptoms', type: 'text', required: false }
    ];
    
    const [instrument] = await db('instruments').insert({
      id: 10,
      project_id: 1,
      name: 'Heart Health Survey',
      fields: JSON.stringify(fields),
      status: 'published',
      created_at: new Date()
    }).returning('*');

    // 3. Create a local survey link
    const surveyToken = crypto.randomBytes(16).toString('hex');
    const [surveyLink] = await db('survey_links').insert({
      id: 50,
      token: surveyToken,
      project_id: 1,
      instrument_id: 10,
      label: 'Patient Heart Health Survey',
      active: true,
      responses: 0,
      created_by: 1,
      sync_pending: true
    }).returning('*');

    console.log(`✅ Seeded local project, instrument, and survey link (ID: ${surveyLink.id}, Token: ${surveyToken})`);

    // 4. Test Sync definition to central (publish)
    console.log('🔄 Publishing survey structure to central cloud...');
    env.deploymentMode = 'standalone'; // Ensure client mode pushes sync
    const syncRes = await syncEntityToCentral('survey', surveyLink.id);
    console.log('Publish result:', syncRes);

    if (!syncRes.synced) {
      throw new Error(`❌ Test Failed: Survey definition sync failed: ${syncRes.error}`);
    }

    // Verify it exists in cloud_surveys on the central server
    const cloudSurvey = await db('cloud_surveys').where('survey_token', surveyToken).first();
    if (!cloudSurvey) {
      throw new Error('❌ Test Failed: Survey was not registered in cloud_surveys table on central server!');
    }
    console.log('✅ Survey registered in cloud_surveys. Schema fields:', cloudSurvey.schema_json);

    // 5. Simulate patient loading public survey details
    console.log('📡 Simulating patient accessing public survey via token...');
    env.deploymentMode = 'saas'; // Flip to SaaS mode so server processes as central support hub
    const detailsRes = await fetch(`http://127.0.0.1:3002/api/survey/${surveyToken}`);
    if (!detailsRes.ok) {
      throw new Error(`❌ Test Failed: Accessing survey details API returned status ${detailsRes.status}`);
    }
    const details = await detailsRes.json();
    console.log('Public Survey Details received:', details);
    if (details.instrument.fields.length !== 2) {
      throw new Error('❌ Test Failed: Public survey fields mismatch!');
    }
    console.log('✅ Public survey details load verified.');

    // 6. Simulate patient submitting response to public central server
    console.log('📡 Simulating patient submitting survey response...');
    env.deploymentMode = 'saas'; // Flip to SaaS mode so server processes as central support hub and buffers response
    const responsePayload = {
      data: {
        age: 45,
        symptoms: 'Chest pain during light exercise'
      }
    };
    const submitRes = await fetch(`http://127.0.0.1:3002/api/survey/${surveyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload)
    });
    if (!submitRes.ok) {
      throw new Error(`❌ Test Failed: Submitting survey response returned status ${submitRes.status}`);
    }
    const submitResult = await submitRes.json();
    console.log('Submission Result:', submitResult);
    console.log('✅ Survey submission verified.');

    // Verify response buffered in cloud_survey_responses
    const bufferedResponse = await db('cloud_survey_responses').where('survey_token', surveyToken).first();
    if (!bufferedResponse) {
      throw new Error('❌ Test Failed: Response was not buffered in cloud_survey_responses!');
    }
    console.log('✅ Response buffered in central database: ', bufferedResponse.response_data);

    // 7. Pull responses from central to client instance
    console.log('🔄 Triggering client pull survey responses...');
    env.deploymentMode = 'standalone'; // Flip back to client mode so we pull and sync locally
    const pullResult = await pullSurveyResponsesFromCentral();
    console.log('Pull result:', pullResult);

    if (pullResult.pulledCount !== 1) {
      throw new Error(`❌ Test Failed: Expected to pull 1 response, but got ${pullResult.pulledCount}`);
    }

    // 8. Verify the record is saved locally in SQLite DB and cloud buffer is empty
    const localRecord = await db('records').where('project_id', 1).first();
    if (!localRecord) {
      throw new Error('❌ Test Failed: Record was not saved in local SQLite database!');
    }
    console.log(`✅ Saved Local Record: ID ${localRecord.record_id}, status: ${localRecord.status}, data: ${localRecord.data}`);
    
    const parsedData = JSON.parse(localRecord.data);
    if (parsedData.age !== 45 || parsedData.symptoms !== 'Chest pain during light exercise') {
      throw new Error('❌ Test Failed: Synced local record data values do not match submitted values!');
    }

    const updatedSurveyLink = await db('survey_links').where('id', surveyLink.id).first();
    if (updatedSurveyLink.responses !== 1) {
      throw new Error(`❌ Test Failed: Local responses counter was not incremented! Current: ${updatedSurveyLink.responses}`);
    }

    // Verify cloud buffer is empty (data deleted for privacy compliance)
    const remainingCloudResponses = await db('cloud_survey_responses').where('survey_token', surveyToken).count('id as count').first();
    const remainingCount = parseInt(remainingCloudResponses.count || 0);
    if (remainingCount !== 0) {
      throw new Error(`❌ Test Failed: Cloud survey response buffer not cleared after pull! Count: ${remainingCount}`);
    }
    console.log('✅ Verified cloud survey response buffer is fully cleared (deleted for security compliance).');

    console.log('🎉 ALL HYBRID CLOUD SURVEY E2E TESTS PASSED SUCCESSFULLY! 🚀');

  } catch (error) {
    console.error('❌ Integration Test Failed:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close(() => {
        console.log('🔌 Mock Central Server stopped.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
};

runTest();
