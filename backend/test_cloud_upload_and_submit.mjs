import db from './src/db/connection.js';
import { env } from './src/config/env.js';
import { syncEntityToCentral } from './src/services/syncManager.js';
import path from 'path';
import fs from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.DEPLOYMENT_MODE = 'standalone';

const testE2ESync = async () => {
  console.log('🚀 Initiating E2E Cloud Sync test with PDF...');

  // 1. Create a dummy PDF file in our local uploads folder
  const uploadsDir = path.resolve(env.uploads.dir);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-E2E_Agent_Verification.pdf`;
  const filePath = path.join(uploadsDir, uniqueFilename);
  
  // Minimal valid PDF structure
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (BLDE EDC Sync Verified!) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000223 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
316
%%EOF`;

  fs.writeFileSync(filePath, pdfContent, 'utf8');
  console.log(`✅ Dummy PDF created at: ${filePath}`);

  try {
    // 2. Insert consultation ticket in local SQLite DB
    const ticketNumber = `CT-AG-${Date.now().toString().slice(-6)}`;
    const [ticket] = await db('consultation_tickets')
      .insert({
        ticket_number: ticketNumber,
        client_name: 'Antigravity AI Agent',
        client_email: 'agent@blde.ac.in',
        department: 'Cardiology',
        principal_investigator: 'Dr. AI Agent',
        project_title: 'E2E PDF Sync Verification',
        expected_outcome: 'Verify file is openable on Render central server',
        reference_pdf_filename: uniqueFilename,
        additional_notes: 'Created automatically by the AI agent to verify E2E PDF uploads.',
        status: 'submitted'
      })
      .returning('*');

    console.log(`✅ Ticket registered locally: ${ticketNumber} (Local ID: ${ticket.id})`);

    // 3. Trigger sync to Central Render server
    console.log('📡 Syncing ticket and PDF binary to central server...');
    const result = await syncEntityToCentral('consultation', ticket.id);
    console.log('Sync Result:', result);

    if (result.synced) {
      console.log('\n🎉 E2E SYNC COMPLETED SUCCESSFULLY!');
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

testE2ESync();
