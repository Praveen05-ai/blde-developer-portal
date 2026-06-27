import fs from 'fs';
import path from 'path';
import { generateLicenseKey } from './src/services/licenseService.js';

const privateKeyPath = 'C:\\Users\\IIC 05\\.gemini\\antigravity\\scratch\\keys\\private.pem';
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const activationDate = new Date('2026-06-25T00:00:00.000Z');
const expiryDate = new Date('2036-06-25T00:00:00.000Z'); // 10 years

const licensePayload = {
  license_type: 'trial',
  activation_date: activationDate.toISOString(),
  expiry_date: expiryDate.toISOString(),
  organization_id: null,
  machine_id: null,
  limits: {
    max_projects: 10,
    max_users: 5,
    max_forms: 50,
    max_records: 10000,
    max_storage_gb: 5,
    max_upload_size_mb: 100,
    max_sessions: 5
  },
  features: {
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
  }
};

const licenseKey = generateLicenseKey(licensePayload, privateKey);
console.log("GENERATED_KEY_START");
console.log(licenseKey);
console.log("GENERATED_KEY_END");
console.log("ACTIVATION_DATE:", activationDate.toISOString());
console.log("EXPIRY_DATE:", expiryDate.toISOString());
