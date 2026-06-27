import db from './src/db/connection.js';
import { env } from './src/config/env.js';
import { syncEntityToCentral } from './src/services/syncManager.js';
import path from 'path';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.DEPLOYMENT_MODE = 'standalone';

const testRealPdfSync = async () => {
  console.log('🚀 Initiating E2E Cloud Sync test with a REAL PDF...');

  const desktopPdfPath = 'C:\\Users\\IIC 05\\Desktop\\AA2959656.pdf.pdf';
  if (!fs.existsSync(desktopPdfPath)) {
    console.error(`❌ Source PDF on desktop not found: ${desktopPdfPath}`);
    process.exit(1);
  }

  // 1. Create a copy in the local uploads directory
  const uploadsDir = path.resolve(env.uploads.dir);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-AA2959656_Real_Test.pdf`;
  const destPath = path.join(uploadsDir, uniqueFilename);

  fs.copyFileSync(desktopPdfPath, destPath);
  console.log(`✅ Real PDF copied to uploads folder: ${destPath}`);

  try {
    // 2. Insert consultation ticket in local SQLite DB
    const ticketNumber = `CT-REAL-${Date.now().toString().slice(-6)}`;
    const [ticket] = await db('consultation_tickets')
      .insert({
        ticket_number: ticketNumber,
        client_name: 'Antigravity Real PDF Tester',
        client_email: 'tester@blde.ac.in',
        department: 'Pediatrics',
        principal_investigator: 'Dr. Real Tester',
        project_title: 'E2E Real PDF Sync Verification',
        expected_outcome: 'Verify that a genuine multi-page PDF is fully openable on Render developer console.',
        reference_pdf_filename: uniqueFilename,
        additional_notes: 'Created automatically to verify real binary PDF transport.',
        status: 'submitted'
      })
      .returning('*');

    console.log(`✅ Ticket registered locally: ${ticketNumber} (Local ID: ${ticket.id})`);

    // 3. Trigger sync to Central Render server
    console.log('📡 Syncing ticket and PDF binary to central server...');
    const result = await syncEntityToCentral('consultation', ticket.id);
    console.log('Sync Result:', result);

    if (result.synced) {
      console.log('\n🎉 E2E REAL PDF SYNC COMPLETED SUCCESSFULLY!');
      console.log(`Verify it here: https://blde-edc-platform.onrender.com/developer.html`);
      console.log(`Open PDF directly: https://blde-edc-platform.onrender.com/uploads/${uniqueFilename}`);
    } else {
      console.error('❌ Sync failed:', result.error);
    }

  } catch (err) {
    console.error('❌ Test failed:', err);
  } finally {
    await db.destroy();
    console.log('Database connection pool destroyed.');
  }
};

testRealPdfSync();
