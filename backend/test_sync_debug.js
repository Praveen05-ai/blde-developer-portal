import db from './src/db/connection.js';
import { env } from './src/config/env.js';
import app from './src/app.js';
import { syncEntityToCentral } from './src/services/syncManager.js';

async function debug() {
  console.log('--- Debugging Sync Flow ---');
  
  env.centralSupportUrl = 'http://127.0.0.1:3002';
  env.licenseKey = 'BLDE-TEST-LICENSE-123';
  env.deploymentMode = 'standalone';
  
  const server = app.listen(3002, async () => {
    console.log('Mock server listening on port 3002.');
    
    try {
      // Clean up and seed
      await db('blueprint_requests').del();
      await db('organizations').del();
      await db('users').del();
      await db('projects').del();
      
      await db('organizations').insert({ id: 1, name: 'BLDE Association', organization_type: 'university', status: 'active' });
      await db('users').insert({ id: 1, name: 'Admin', email: 'admin@blde.ac.in', password: 'hashedpassword', role: 'admin', organization_id: 1 });
      await db('projects').insert({ id: 1, title: 'Test AI Project', department: 'General Medicine', guide_name: 'Dr. Shivanand', project_type: 'AI Medical Project', organization_id: 1, deleted: false });
      
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
      
      console.log('Created local blueprint. Triggering sync...');
      const res = await syncEntityToCentral('blueprint', 99);
      console.log('syncEntityToCentral returned:', res);
      
      // Check database
      const records = await db('blueprint_requests').select('*');
      console.log('All blueprint records in DB:', records);
    } catch (err) {
      console.error('Error in debug:', err);
    } finally {
      server.close();
      await db.destroy();
    }
  });
}

debug();
