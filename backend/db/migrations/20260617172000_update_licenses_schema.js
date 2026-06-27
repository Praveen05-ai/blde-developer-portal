import { generateLicenseKey } from '../../src/services/licenseService.js';

export const up = async function (knex) {
  // 1. Add Unique constraint (wrapped in try-catch to prevent duplication errors)
  try {
    await knex.schema.alterTable('licenses', (table) => {
      table.unique('license_key');
    });
  } catch (err) {
    // Unique constraint already exists
  }

  // 2. Insert Default Trial Seed Data if no licenses exist
  const existing = await knex('licenses').first();
  if (!existing) {
    let licenseKey;
    let licenseType = 'trial';
    let status = 'trial';
    let activationDate;
    let expiryDate;
    let limits;
    let features;

    try {
      activationDate = new Date();
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const licensePayload = {
        license_type: 'trial',
        activation_date: activationDate.toISOString(),
        expiry_date: expiryDate.toISOString(),
        organization_id: null,
        machine_id: null,
        limits: {
          max_projects: 1,
          max_users: 1,
          max_forms: 10,
          max_records: 1000,
          max_storage_gb: 1,
          max_upload_size_mb: 50,
          max_sessions: 1
        },
        features: {
          survey_module: false,
          api_access: false,
          export_excel: false,
          export_csv: false,
          export_pdf: true,
          file_attachments: true,
          randomization_module: false,
          esignature: false,
          notifications: false,
          mobile_access: false,
          backup_restore: false,
          custom_branding: false
        }
      };

      const secret = process.env.JWT_SECRET || 'blde_edc_licensing_gxp_secret_lock_2026';
      licenseKey = generateLicenseKey(licensePayload, secret);
      limits = licensePayload.limits;
      features = licensePayload.features;
    } catch (err) {
      // Fallback if private key is not found (expected in client packages)
      console.warn('Private key not found. Using pre-signed trial license fallback...');
      licenseKey = 'eyJkYXRhIjp7ImFjdGl2YXRpb25fZGF0ZSI6IjIwMjYtMDYtMjVUMDA6MDA6MDAuMDAwWiIsImV4cGlyeV9kYXRlIjoiMjAzNi0wNi0yNVQwMDowMDowMC4wMDBaIiwiZmVhdHVyZXMiOnsiYXBpX2FjY2VzcyI6dHJ1ZSwiYmFja3VwX3Jlc3RvcmUiOnRydWUsImN1c3RvbV9icmFuZGluZyI6dHJ1ZSwiZXNpZ25hdHVyZSI6dHJ1ZSwiZXhwb3J0X2NzdiI6dHJ1ZSwiZXhwb3J0X2V4Y2VsIjp0cnVlLCJleHBvcnRfcGRmIjp0cnVlLCJmaWxlX2F0dGFjaG1lbnRzIjp0cnVlLCJtb2JpbGVfYWNjZXNzIjp0cnVlLCJub3RpZmljYXRpb25zIjp0cnVlLCJyYW5kb21pemF0aW9uX21vZHVsZSI6dHJ1ZSwic3VydmV5X21vZHVsZSI6dHJ1ZX0sImxpY2Vuc2VfdHlwZSI6InRyaWFsIiwibGltaXRzIjp7Im1heF9mb3JtcyI6NTAsIm1heF9wcm9qZWN0cyI6MTAsIm1heF9yZWNvcmRzIjoxMDAwMCwibWF4X3Nlc3Npb25zIjo1LCJtYXhfc3RvcmFnZV9nYiI6NSwibWF4X3VwbG9hZF9zaXplX21iIjoxMDAsIm1heF91c2VycyI6NX0sIm1hY2hpbmVfaWQiOm51bGwsIm9yZ2FuaXphdGlvbl9pZCI6bnVsbH0sImtpZCI6ImJsZGUta2V5LTIwMjYtdjEiLCJ0aW1lc3RhbXAiOiIyMDI2LTA2LTI1VDA1OjIwOjI0LjY2M1oiLCJ2IjoxfQ.1ae1ce33f0960bb562058344784d6fe51f417c3b9e86fa598e8674e3bf864d20242ef89012c21709ae5439b997161e3cd261c0c5be4269f645abf00aac4cd2d92541202d2769ac9f1528ce675b621f4e57653aba4d0048cbb48df343acf559bc44e6628561c1fc7a1cad188eab5f59af09afed820435248d019c8bde40a926f4fe3e82d6635a73357751047ab632b23b9d8c76cfe3ebbf2b60024ca928bd23af1f0b55da7cabc50c9851bb2026fbe098d6d10f6f0853255009d420e5790c30bd31a7d80eb193627ef5846a10d768bbf7c903e54f0df3c5c98085a956c4cf8b5882b3adeadf7ef17c6193a4d0caaa507d1954ebd01d0480ea5992167a7b40587b';
      activationDate = new Date('2026-06-25T00:00:00.000Z');
      expiryDate = new Date('2036-06-25T00:00:00.000Z');
      limits = {
        max_projects: 10,
        max_users: 5,
        max_forms: 50,
        max_records: 10000,
        max_storage_gb: 5,
        max_upload_size_mb: 100,
        max_sessions: 5
      };
      features = {
        survey_module: true,
        api_access: true,
        export_excel: true,
        export_csv: true,
        export_pdf: true,
        file_attachments: true,
        randomization_module: true,
        esignature: true,
        notifications: true,
        mobile_access: true,
        backup_restore: true,
        custom_branding: true
      };
    }
    
    // Extract signature part from key
    const signature = licenseKey.split('.')[1];

    // Insert into licenses table
    const returningResult = await knex('licenses')
      .insert({
        license_key: licenseKey,
        license_type: licenseType,
        status: status,
        activation_date: activationDate,
        expiry_date: expiryDate,
        machine_id: null,
        organization_id: null,
        signature: signature
      })
      .returning('id');

    // Dialect-safe parsing of returning ID
    let licenseId = null;
    if (returningResult && returningResult.length > 0) {
      const rawResult = returningResult[0];
      if (typeof rawResult === 'object' && rawResult !== null) {
        licenseId = rawResult.id || Object.values(rawResult)[0];
      } else {
        licenseId = rawResult;
      }
    }

    // Fallback lookup if returning ID was not resolved
    if (!licenseId) {
      const row = await knex('licenses').where({ license_key: licenseKey }).first();
      licenseId = row.id;
    }

    // Insert into license_usage table
    await knex('license_usage').insert({
      license_id: licenseId,
      ...limits
    });

    // Insert into license_features table
    await knex('license_features').insert({
      license_id: licenseId,
      ...features
    });

    // Insert into license_logs table
    await knex('license_logs').insert({
      license_id: licenseId,
      action: 'activation',
      details: 'Initial GxP trial license automatically activated on system migration.',
      timestamp: activationDate
    });
  }
};

export const down = async function (knex) {
  try {
    await knex.schema.alterTable('licenses', (table) => {
      table.dropUnique('license_key');
    });
  } catch (err) {
    // Unique constraint didn't exist or already dropped
  }
  await knex('licenses').del();
};
