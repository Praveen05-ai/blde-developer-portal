import db from './src/db/connection.js';
import { env } from './src/config/env.js';
import app from './src/app.js';
import { syncEntityToCentral, pullDeliverablesFromCentral } from './src/services/syncManager.js';
import fs from 'fs';
import path from 'path';

const runTest = async () => {
  console.log('🏁 Starting E2E Synchronization Integration Test...');
  let server;

  try {
    // 1. Start backend server on port 3009 (acts as Central Support Hub)
    env.centralSupportUrl = 'http://127.0.0.1:3009';
    env.licenseKey = 'BLDE-TEST-LICENSE-123';
    env.deploymentMode = 'standalone'; // Client mode
    
    server = app.listen(3009, () => {
      console.log('📡 Mock Central Support Server listening on port 3009');
    });

    // Clean up tables
    await db('deliverables').del();
    await db('blueprint_requests').del();
    await db('package_requests').del();
    await db('support_tickets').del();
    await db('organizations').del();
    await db('users').del();
    await db('projects').del();

    // 2. Insert seed data
    await db('organizations').insert({ id: 1, name: 'BLDE Association', organization_type: 'university', status: 'active' });
    await db('users').insert({ id: 1, name: 'Admin', email: 'admin@blde.ac.in', password: 'hashedpassword', role: 'admin', organization_id: 1 });
    await db('projects').insert({ id: 1, title: 'Test AI Project', department: 'General Medicine', guide_name: 'Dr. Shivanand', project_type: 'AI Medical Project', organization_id: 1, deleted: false });

    // 3. Create a local blueprint request (representing a researcher submitting a request)
    const [blueprint] = await db('blueprint_requests').insert({
      id: 99,
      organization_id: 1,
      project_id: 1,
      submitted_by: 1,
      title: 'Local Test Blueprint',
      template_type: 'ai_medical',
      requirements: 'Must analyze clinical trial patterns.',
      status: 'submitted'
    }).returning('*');

    console.log(`✅ Created local blueprint request: ${blueprint.title} (Local ID: ${blueprint.id})`);

    // 4. Trigger client pushing the request to the central server
    console.log('🔄 Triggering sync to central server...');
    const syncResult = await syncEntityToCentral('blueprint', blueprint.id);
    console.log('Sync push result:', syncResult);

    // 5. Verify the request arrived at the central server (it should have inserted a new record mapped to client_local_id)
    const centralRecord = await db('blueprint_requests')
      .where({ client_license_id: env.licenseKey, client_local_id: blueprint.id })
      .first();

    if (!centralRecord) {
      throw new Error('❌ TEST FAILED: Blueprint request was not created on the central server database!');
    }
    console.log(`✅ Sync verified on Central Support Server: Central ID: ${centralRecord.id}, client_local_id: ${centralRecord.client_local_id}`);

    // 6. Simulate developer uploading a deliverable file for this request on the Central server
    // Create a mock deliverable file on disk
    const mockFileName = 'mock_blueprint.pdf';
    const mockFileDir = path.resolve(env.uploads.dir);
    if (!fs.existsSync(mockFileDir)) {
      fs.mkdirSync(mockFileDir, { recursive: true });
    }
    const mockFilePath = path.join(mockFileDir, mockFileName);
    fs.writeFileSync(mockFilePath, '%PDF-1.4 Mock PDF Content'); // Magic number is %PDF-

    const [centralDeliverable] = await db('deliverables').insert({
      organization_id: 1,
      related_type: 'blueprint',
      related_id: centralRecord.id, // Linked to the central request record ID
      uploaded_by: 1,
      name: mockFileName,
      file_path: `/uploads/${mockFileName}`,
      file_size: 25,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // Mock checksum
      version: 1,
      delivery_notes: 'Here is your custom AI blueprint template.',
      category: 'Project Blueprint',
      mime_type: 'application/pdf',
      created_at: new Date()
    }).returning('*');

    console.log(`✅ Created deliverable on central server: ${centralDeliverable.name} linked to Request ID: ${centralRecord.id}`);

    // 7. Trigger the client pulling the deliverable from the central server
    console.log('🔄 Triggering client deliverable pull sync...');
    
    // We temporarily remove the mock file so the pull can download it cleanly
    const pulledFilePrefix = 'uploads';
    
    const pullResult = await pullDeliverablesFromCentral();
    console.log('Pull result:', pullResult);

    if (pullResult.pulledCount === 0) {
      throw new Error('❌ TEST FAILED: No deliverables were pulled from the central server!');
    }

    // 8. Verify the deliverable is integrated locally and the request status is updated
    const localDeliverable = await db('deliverables')
      .where({ related_type: 'blueprint', related_id: blueprint.id }) // Should be linked back to client_local_id (99)
      .first();

    if (!localDeliverable) {
      throw new Error('❌ TEST FAILED: Local deliverable record was not created!');
    }

    const updatedBlueprint = await db('blueprint_requests').where({ id: blueprint.id }).first();
    if (updatedBlueprint.status !== 'ready_for_delivery') {
      throw new Error(`❌ TEST FAILED: Local request status was not updated to ready_for_delivery! Current: ${updatedBlueprint.status}`);
    }

    const downloadedFilePath = path.join(mockFileDir, path.basename(localDeliverable.file_path));
    if (!fs.existsSync(downloadedFilePath)) {
      throw new Error(`❌ TEST FAILED: Physical file was not downloaded to local path: ${downloadedFilePath}`);
    }

    const fileContent = fs.readFileSync(downloadedFilePath, 'utf8');
    if (!fileContent.startsWith('%PDF-')) {
      throw new Error(`❌ TEST FAILED: Downloaded file content is invalid or corrupted! Content: ${fileContent}`);
    }

    console.log('🎉 E2E INTEGRATION TEST COMPLETED SUCCESSFULLY! Sync engine is 100% functional.');
    
    // Cleanup physical downloaded files
    try {
      fs.unlinkSync(mockFilePath);
      if (mockFilePath !== downloadedFilePath) {
        fs.unlinkSync(downloadedFilePath);
      }
    } catch (_) {}

  } catch (error) {
    console.error('❌ E2E INTEGRATION TEST FAILED:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close(() => {
        console.log('🔌 Server stopped.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }
};

runTest();
