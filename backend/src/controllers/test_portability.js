process.env.JWT_SECRET = 'blde_secret_test_key_2026_change_me';
import db from '../db/connection.js';
import { exportProjectTemplate, importProjectTemplate } from './portabilityController.js';
import assert from 'assert';

console.log('🧪 Starting Project Portability Engine Verification (SQLite Friendly)...');

const mockUser = { id: 1, name: 'Test Administrator', email: 'admin@blde.edu', role: 'admin' };

const runTests = async () => {
  let projectId;
  let importedId;

  try {
    // 1. Create dummy project using primary db connection
    const [project] = await db('projects')
      .insert({
        title: 'Cardiac Trial ' + Date.now(),
        description: 'UAT testing configuration portability',
        longitudinal: true,
        randomisation_enabled: true,
        multi_site: true,
        created_by: mockUser.id
      })
      .returning('*');

    projectId = project.id;

    // Add a test site
    await db('sites').insert({
      project_id: projectId,
      name: 'Site A UAT',
      code: 'SA_UAT',
      city: 'Hubli',
      pi_name: 'Dr. Test',
      pi_email: 'test@blde.edu'
    });

    // Add a test instrument
    const [inst] = await db('instruments').insert({
      project_id: projectId,
      name: 'Baseline Vitals Form',
      description: 'Intake form',
      fields: JSON.stringify([{ id: 'f_bp', label: 'Blood Pressure', type: 'text' }]),
      repeating: false
    }).returning('*');

    // Add a test event
    const [ev] = await db('events').insert({
      project_id: projectId,
      name: 'Baseline Visit',
      day_offset: 0,
      window_before: 0,
      window_after: 0
    }).returning('*');

    // Link event to instrument
    await db('event_instruments').insert({
      event_id: ev.id,
      instrument_id: inst.id,
      required: true
    });

    // Add a mock randomisation scheme
    const [scheme] = await db('rand_schemes').insert({
      project_id: projectId,
      name: 'Stratified Scheme',
      arms: JSON.stringify(['ARM A', 'ARM B']),
      ratio: JSON.stringify([1, 1])
    }).returning('*');

    await db('rand_blocks').insert({
      scheme_id: scheme.id,
      strata_key: 'default',
      block_number: 1,
      sequence: JSON.stringify(['ARM A', 'ARM B'])
    });

    // 2. Perform Mock Export
    const reqMock = { params: { pid: projectId }, user: mockUser, ip: '127.0.0.1' };
    let exportedData = null;
    const resMock = {
      setHeader: () => {},
      send: (data) => { exportedData = data; }
    };

    await exportProjectTemplate(reqMock, resMock, (err) => {
      if (err) throw err;
    });

    assert.ok(exportedData, 'Export should generate Base64 encrypted payload');
    console.log('✅ Export successfully generated encrypted template (bytes size: ' + exportedData.length + ')');

    // 3. Perform Mock Import
    const reqImportMock = { body: { packageData: exportedData }, user: mockUser, ip: '127.0.0.1' };
    let importRes = null;
    const resImportMock = {
      status: (code) => {
        assert.strictEqual(code, 201, 'Import status should be 201');
        return {
          json: (data) => { importRes = data; }
        };
      }
    };

    await importProjectTemplate(reqImportMock, resImportMock, (err) => {
      if (err) throw err;
    });

    assert.ok(importRes && importRes.success, 'Import should return success');
    importedId = importRes.project_id;
    console.log('✅ Import successfully remapped keys and registered imported project: ' + importRes.title);

    // Verify mapped event instruments rows exist in DB for new project
    const eventInsts = await db('event_instruments as ei')
      .join('events as e', 'ei.event_id', 'e.id')
      .where('e.project_id', importedId);
    
    assert.strictEqual(eventInsts.length, 1, 'Should have exactly 1 event-instrument mapping row in target project');
    console.log('✅ Portability event-instruments mapping assertions passed.');

    console.log('\n⭐ PORTABILITY VERIFICATION COMPLETED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ PORTABILITY VERIFICATION FAILED: ', error);
    process.exit(1);
  } finally {
    // 4. Clean up mock database records
    console.log('🧹 Cleaning up test database records...');
    if (projectId) {
      await db('projects').where({ id: projectId }).del();
    }
    if (importedId) {
      await db('projects').where({ id: importedId }).del();
    }
    await db.destroy();
  }
};

runTests();
