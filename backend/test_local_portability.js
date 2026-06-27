import db from './src/db/connection.js';
import { exportProjectTemplate, importProjectTemplate } from './src/controllers/portabilityController.js';
import { encryptPackage, decryptPackage } from './src/utils/crypto.js';

const runTest = async () => {
  console.log('🚀 Running local project portability test...');
  try {
    // 1. Fetch default project
    const project = await db('projects').where({ deleted: false }).first();
    if (!project) {
      console.log('❌ No project found in database to export.');
      process.exit(1);
    }
    console.log(`✅ Found project to export: "${project.title}" (ID: ${project.id})`);

    // 2. Generate export payload manually (similar to controller)
    const pid = project.id;
    const instruments = await db('instruments').where({ project_id: pid });
    const events = await db('events').where({ project_id: pid });
    const eventInstruments = await db('event_instruments as ei')
      .join('events as e', 'ei.event_id', 'e.id')
      .join('instruments as i', 'ei.instrument_id', 'i.id')
      .where('e.project_id', pid)
      .select('ei.*', 'e.name as event_name', 'i.name as instrument_name');
    const sites = await db('sites').where({ project_id: pid });
    const randSchemes = await db('rand_schemes').where({ project_id: pid });
    let randBlocks = [];
    if (randSchemes.length > 0) {
      const schemeIds = randSchemes.map(s => s.id);
      randBlocks = await db('rand_blocks').whereIn('scheme_id', schemeIds);
    }
    const dqRules = await db('dq_rules').where({ project_id: pid });
    const alertRules = await db('alert_rules').where({ project_id: pid });

    const packagePayload = {
      metadata: {
        package_type: 'project_setup',
        schema_version: 20260602,
        platform_version: '16.0',
        created_date: new Date().toISOString(),
        created_by: { user_id: 1, name: 'System Test' }
      },
      project: {
        title: project.title,
        description: project.description,
        longitudinal: !!project.longitudinal,
        randomisation_enabled: !!project.randomisation_enabled,
        multi_site: !!project.multi_site
      },
      sites: sites.map(s => ({ name: s.name, code: s.code, city: s.city, pi_name: '', pi_email: '', active: !!s.active })),
      instruments: instruments.map(i => ({ old_id: i.id, name: i.name, description: i.description, fields: typeof i.fields === 'string' ? JSON.parse(i.fields) : i.fields || [], repeating: !!i.repeating })),
      events: events.map(e => ({ old_id: e.id, name: e.name, day_offset: e.day_offset, window_before: e.window_before, window_after: e.window_after, description: e.description, sort_order: e.sort_order })),
      event_instruments: eventInstruments.map(ei => ({ event_name: ei.event_name, instrument_name: ei.instrument_name, required: !!ei.required })),
      rand_schemes: randSchemes.map(s => ({ old_id: s.id, name: s.name, description: s.description, algorithm: s.algorithm, block_size: s.block_size, stratify_by: typeof s.stratify_by === 'string' ? JSON.parse(s.stratify_by) : s.stratify_by || [], arms: typeof s.arms === 'string' ? JSON.parse(s.arms) : s.arms || [], ratio: typeof s.ratio === 'string' ? JSON.parse(s.ratio) : s.ratio || [], sealed: !!s.sealed })),
      rand_blocks: randBlocks.map(b => ({ scheme_id: b.scheme_id, strata_key: b.strata_key, block_number: b.block_number, sequence: typeof b.sequence === 'string' ? JSON.parse(b.sequence) : b.sequence || [], used: false })),
      dq_rules: dqRules.map(r => ({ name: r.name, description: r.description, rule_type: r.rule_type, old_instrument_id: r.instrument_id, field_id: r.field_id, operator: r.operator, value: r.value, severity: r.severity, active: !!r.active })),
      alert_rules: alertRules.map(r => ({ name: r.name, old_instrument_id: r.instrument_id, trigger_field: r.trigger_field, trigger_operator: r.trigger_operator, trigger_value: r.trigger_value, alert_type: r.alert_type, recipients: '[]', subject: r.subject, message: r.message, active: !!r.active }))
    };

    // Encrypt
    const base64Encrypted = encryptPackage(packagePayload);
    console.log('✅ Encrypted package successfully. Base64 length:', base64Encrypted.length);

    // Decrypt
    const decrypted = decryptPackage(base64Encrypted);
    console.log('✅ Decrypted package successfully. Title:', decrypted.project.title);

    // Try mock request to import
    const reqMock = {
      body: { packageData: base64Encrypted },
      user: { id: 1, name: 'Local Admin', role: 'admin' },
      ip: '127.0.0.1'
    };

    const resMock = {
      status: (code) => {
        console.log(`Response Status: ${code}`);
        return resMock;
      },
      json: (data) => {
        console.log('Response JSON:', data);
        return resMock;
      }
    };

    console.log('📡 Calling importProjectTemplate...');
    await importProjectTemplate(reqMock, resMock, (err) => {
      console.error('Next middleware called with error:', err);
    });

  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    await db.destroy();
    console.log('Database pool destroyed.');
  }
};

runTest();
