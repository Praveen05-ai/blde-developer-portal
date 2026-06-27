process.env.JWT_SECRET = 'blde_secret_test_key_2026_change_me';
import fs from 'fs';
import path from 'path';
import { encryptPackage } from './crypto.js';

console.log('🏗️ Generating GxP study templates...');

const templates = {};

const baseMetadata = {
  package_type: 'project_setup',
  schema_version: 20260602,
  platform_version: '16.0',
  created_date: new Date().toISOString(),
  created_by: { user_id: 1, name: 'BLDE Certified Template Registry' }
};

// 1. Cross-sectional
templates.cross_sectional = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Cross-sectional Population Health Survey', description: 'Epidemiological survey configuration', longitudinal: false, randomisation_enabled: false, multi_site: true },
  sites: [{ name: 'Hubli Main Site', code: 'HBL-01', city: 'Hubli', active: true }],
  instruments: [
    {
      old_id: 1, name: 'Demographics & Lifestyle Intake', description: 'Socio-demographics and daily behavior survey', repeating: false,
      fields: [
        { id: 'f_name', label: 'Full Name', type: 'text', required: true },
        { id: 'f_age', label: 'Age (Years)', type: 'number', required: true, validation: { type: 'range', min: 18, max: 100, message: 'Must be an adult' } },
        { id: 'f_gender', label: 'Gender', type: 'radio', required: true, options: ['Male', 'Female', 'Other'] },
        { id: 'f_smoker', label: 'Smoker Status', type: 'select', required: true, options: ['Current', 'Former', 'Never'] }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 2. Cohort Study
templates.cohort = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Prospective Cohort Study', description: 'Longitudinal follow-up registry template', longitudinal: true, randomisation_enabled: false, multi_site: true },
  sites: [{ name: 'Bagalkot Clinic', code: 'BGK-01', city: 'Bagalkot', active: true }],
  instruments: [
    {
      old_id: 10, name: 'Baseline Screening Intake', description: 'Initial patient screening', repeating: false,
      fields: [
        { id: 'f_inclusion', label: 'Meets Inclusion Criteria', type: 'radio', required: true, options: ['Yes', 'No'] },
        { id: 'f_weight', label: 'Weight (kg)', type: 'number', required: true }
      ]
    },
    {
      old_id: 11, name: 'Follow-up Assessment Form', description: 'Repeating follow-up metrics', repeating: true,
      fields: [
        { id: 'f_systolic', label: 'Systolic BP', type: 'number', required: true },
        { id: 'f_diastolic', label: 'Diastolic BP', type: 'number', required: true }
      ]
    }
  ],
  events: [
    { old_id: 20, name: 'Day 0 Screening', day_offset: 0, window_before: 0, window_after: 2, sort_order: 1 },
    { old_id: 21, name: 'Month 1 Checkup', day_offset: 30, window_before: 3, window_after: 3, sort_order: 2 }
  ],
  event_instruments: [
    { event_name: 'Day 0 Screening', instrument_name: 'Baseline Screening Intake', required: true },
    { event_name: 'Month 1 Checkup', instrument_name: 'Follow-up Assessment Form', required: true }
  ],
  rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 3. Case-Control
templates.case_control = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Case-Control Exposure Study', description: 'Matched exposure auditing template', longitudinal: false, randomisation_enabled: false, multi_site: false },
  sites: [{ name: 'Main Hospital', code: 'MAIN', city: 'Vijayapura', active: true }],
  instruments: [
    {
      old_id: 30, name: 'Subject Matching Details', description: 'Classification of case/control cohorts', repeating: false,
      fields: [
        { id: 'f_subject_type', label: 'Subject Classification', type: 'radio', required: true, options: ['Case', 'Control'] },
        { id: 'f_matching_id', label: 'Matching ID Target', type: 'text', required: true }
      ]
    },
    {
      old_id: 31, name: 'Environmental Exposure Log', description: 'Exposure criteria details', repeating: false,
      fields: [
        { id: 'f_chemical_exp', label: 'Chemical Exposure History', type: 'radio', required: true, options: ['Yes', 'No'] },
        { id: 'f_years_exp', label: 'Duration of Exposure (Years)', type: 'number', required: false }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 4. Clinical Registry
templates.clinical_registry = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Departmental Clinical Registry', description: 'Standard disease quality auditing template', longitudinal: false, randomisation_enabled: false, multi_site: true },
  sites: [{ name: 'Pediatrics Site', code: 'PED-01', city: 'Vijayapura', active: true }],
  instruments: [
    {
      old_id: 40, name: 'Disease Indicators Registry', description: 'Diagnosis and comorbidity parameters', repeating: false,
      fields: [
        { id: 'f_diag_date', label: 'Diagnosis Date', type: 'date', required: true },
        { id: 'f_icd_10', label: 'ICD-10 Code', type: 'text', required: true },
        { id: 'f_severity', label: 'Severity Grade', type: 'select', required: true, options: ['Mild', 'Moderate', 'Severe'] }
      ]
    },
    {
      old_id: 41, name: 'Repeating SAE Event Report', description: 'Serious Adverse Event Logging', repeating: true,
      fields: [
        { id: 'f_sae_onset', label: 'Onset Date', type: 'date', required: true },
        { id: 'f_sae_desc', label: 'Description of Event', type: 'textarea', required: true }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 5. Questionnaire
templates.questionnaire = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Quality of Life Scale Survey', description: 'Subjective wellness scale collection template', longitudinal: false, randomisation_enabled: false, multi_site: false },
  sites: [{ name: 'Default Site', code: 'DEF-01', city: 'Vijayapura', active: true }],
  instruments: [
    {
      old_id: 50, name: 'WHOQOL-BREF Scale Intake', description: 'World Health Organization Quality of Life metrics', repeating: false,
      fields: [
        { id: 'f_q1_phys', label: 'How would you rate your physical health?', type: 'select', required: true, options: ['1 - Very Poor', '2 - Poor', '3 - Neither', '4 - Good', '5 - Very Good'] },
        { id: 'f_q2_psych', label: 'How would you rate your psychological state?', type: 'select', required: true, options: ['1 - Very Poor', '2 - Poor', '3 - Neither', '4 - Good', '5 - Very Good'] }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 6. Medical Image AI
templates.medical_image_ai = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Radiology Image Classification AI Registry', description: 'PACS/DICOM metadata annotations template', longitudinal: false, randomisation_enabled: false, multi_site: true },
  sites: [{ name: 'Imaging Center A', code: 'IMG-A', city: 'Hubli', active: true }],
  instruments: [
    {
      old_id: 60, name: 'DICOM File Upload Metadata', description: 'Image file links and imaging modalities', repeating: false,
      fields: [
        { id: 'f_scan_id', label: 'Imaging Scan ID', type: 'text', required: true },
        { id: 'f_modality', label: 'Modality', type: 'select', required: true, options: ['CT', 'MRI', 'Chest X-Ray', 'Ultrasound'] },
        { id: 'f_dicom_file', label: 'Attach Reference Image (PDF/DICOM-Report)', type: 'file', required: true }
      ]
    },
    {
      old_id: 61, name: 'AI Annotation Checklist', description: 'Imaging labels and expert review checkboxes', repeating: false,
      fields: [
        { id: 'f_lesion_detected', label: 'Lesion Present', type: 'radio', required: true, options: ['Yes', 'No'] },
        { id: 'f_lesion_size_mm', label: 'Max Lesion Size (mm)', type: 'number', required: false }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// 7. Medical Audio AI
templates.medical_audio_ai = encryptPackage({
  metadata: baseMetadata,
  project: { title: 'Respiratory Audio Diagnostic AI Registry', description: 'Acoustic recordings metadata annotations', longitudinal: false, randomisation_enabled: false, multi_site: false },
  sites: [{ name: 'Default Site', code: 'DEF-01', city: 'Vijayapura', active: true }],
  instruments: [
    {
      old_id: 70, name: 'Acoustic Sound File Details', description: 'Audio recording configuration specifications', repeating: false,
      fields: [
        { id: 'f_recording_id', label: 'Audio Recording ID', type: 'text', required: true },
        { id: 'f_device_type', label: 'Recording Microphone Device', type: 'select', required: true, options: ['Smartphone Native', 'Studio Mic', 'Steth-Digital'] },
        { id: 'f_audio_file', label: 'Attach Audio Waveform (PDF/Report)', type: 'file', required: true }
      ]
    },
    {
      old_id: 71, name: 'Clinical Confirmed Class Label', description: 'Expert clinical diagnoses labels', repeating: false,
      fields: [
        { id: 'f_label', label: 'Confirmed Diagnosis', type: 'radio', required: true, options: ['Pneumonia', 'Bronchitis', 'Healthy Control'] }
      ]
    }
  ],
  events: [], event_instruments: [], rand_schemes: [], rand_blocks: [], dq_rules: [], alert_rules: []
});

// Write to frontend/templates.json
const destPath = path.resolve('frontend/templates.json');
fs.writeFileSync(destPath, JSON.stringify(templates, null, 2), 'utf8');
console.log('✅ 7 clinical study templates compiled and written successfully to: ', destPath);
