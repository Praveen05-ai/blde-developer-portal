import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

const isPIIKey = (key) => {
  const k = key.toLowerCase();
  return k.includes('initials') ||
         k.includes('name') ||
         k.includes('dob') ||
         k.includes('birth') ||
         k.includes('date') ||
         k.includes('phone') ||
         k.includes('email') ||
         k.includes('address') ||
         k.includes('mobile') ||
         k.includes('ssn') ||
         k.includes('contact');
};

export const exportCSV = async (req, res, next) => {
  const { pid } = req.params;
  const deidentify = req.query.deidentify === 'true' || req.query.mask_pii === 'true';

  try {
    let queryBuilder = db('records as r')
      .leftJoin('sites as s', 'r.site_id', 's.id')
      .leftJoin('instruments as i', 'r.instrument_id', 'i.id')
      .select('r.record_id', 's.code as site_code', 'r.status', 'r.created_at', 'r.data', 'i.name as instrument_name')
      .where('r.project_id', pid);

    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      queryBuilder = queryBuilder.where('r.entered_by', req.user.id);
    }

    const records = await queryBuilder.orderBy('r.record_id');

    let csvContent = 'Record_ID,Site_Code,Form_Name,Form_Status,Date_Created';

    if (records.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.attachment('dataset.csv');
      return res.status(200).send(csvContent);
    }

    // Extract all unique dynamic field IDs across all records to build table headers
    const dynamicKeys = new Set();
    records.forEach(r => {
      const dataObj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {};
      Object.keys(dataObj).forEach(k => dynamicKeys.add(k));
    });

    const headerKeys = Array.from(dynamicKeys);
    headerKeys.forEach(k => {
      csvContent += `,${k}`;
    });
    csvContent += '\n';

    // Build subject ID anonymization mapping
    const recordIdMap = new Map();
    let nextSubjId = 1;
    if (deidentify) {
      records.forEach(r => {
        if (!recordIdMap.has(r.record_id)) {
          const paddedId = 'SUBJ_' + String(nextSubjId).padStart(3, '0');
          recordIdMap.set(r.record_id, paddedId);
          nextSubjId++;
        }
      });
    }

    // Populate rows
    records.forEach(r => {
      const dataObj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {};
      
      let dateStr = new Date(r.created_at).toISOString().split('T')[0];
      if (deidentify) {
        dateStr = '[REDACTED]';
      }
      
      const recId = deidentify ? recordIdMap.get(r.record_id) : r.record_id;
      let row = `"${recId}","${r.site_code || 'none'}","${r.instrument_name || 'unknown'}","${r.status}","${dateStr}"`;
      
      headerKeys.forEach(k => {
        let val = dataObj[k] !== undefined && dataObj[k] !== null ? dataObj[k] : '';
        if (deidentify && isPIIKey(k)) {
          val = '[REDACTED]';
        }
        // Escape quotes
        const escaped = String(val).replace(/"/g, '""');
        row += `,"${escaped}"`;
      });
      
      csvContent += row + '\n';
    });

    logger.info(`CSV Export compiled for project ${pid} (De-identified: ${deidentify}) by ${req.user.email}`);

    res.setHeader('Content-Type', 'text/csv');
    res.attachment(`blde_edc_project_${pid}_dataset.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    next(error);
  }
};

export const exportRScript = async (req, res, next) => {
  const { pid } = req.params;

  try {
    const rScript = `# ==============================================================================
# BLDE DU EDC — AUTO-GENERATED R ANALYTICAL LOAD SCRIPT
# Project Context ID: ${pid}
# Generated: ${new Date().toISOString()}
# ==============================================================================

message("Reading dataset from CSV...")
dataset_file <- "blde_edc_project_${pid}_dataset.csv"

if (!file.exists(dataset_file)) {
  stop(paste("File not found:", dataset_file, "\\nPlace this script in the same directory as the CSV download."))
}

# Load raw file
blde_data <- read.csv(
  dataset_file,
  header = TRUE,
  stringsAsFactors = FALSE,
  na.strings = c("", "NA", "N/A")
)

# Convert metadata classes
blde_data$Date_Created <- as.Date(blde_data$Date_Created)
blde_data$Form_Status <- as.factor(blde_data$Form_Status)
blde_data$Site_Code <- as.factor(blde_data$Site_Code)

# Summary of study data
message("Dataset loaded successfully!")
print(summary(blde_data))
`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.attachment(`load_project_${pid}_data.R`);
    res.status(200).send(rScript);
  } catch (error) {
    next(error);
  }
};

export const exportPythonScript = async (req, res, next) => {
  const { pid } = req.params;

  try {
    const pythonScript = `"""
==============================================================================
BLDE DU EDC — AUTO-GENERATED PYTHON PANDAS LOAD SCRIPT
Project Context ID: ${pid}
Generated: ${new Date().toISOString()}
==============================================================================
"""

import os
import pandas as pd

dataset_file = "blde_edc_project_${pid}_dataset.csv"

if not os.path.exists(dataset_file):
    print(f"❌ Error: File not found: {dataset_file}")
    print("Please place this python script in the same directory as the CSV download.")
else:
    # Load dataset
    df = pd.read_csv(dataset_file, na_values=['', 'NA', 'N/A'])
    
    # Format metadata columns
    df['Date_Created'] = pd.to_datetime(df['Date_Created'])
    df['Form_Status'] = df['Form_Status'].astype('category')
    df['Site_Code'] = df['Site_Code'].astype('category')
    
    print("✅ BLDE EDC Clinical Trial Dataset Loaded successfully!")
    print("\\n--- DATA HEAD ---")
    print(df.head())
    print("\\n--- STATISTICAL INFOS ---")
    print(df.describe(include='all'))
`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.attachment(`load_project_${pid}_data.py`);
    res.status(200).send(pythonScript);
  } catch (error) {
    next(error);
  }
};

export const exportZip = async (req, res, next) => {
  const { pid } = req.params;
  const deidentify = req.query.deidentify === 'true' || req.query.mask_pii === 'true';

  try {
    // 1. Fetch CSV dataset (reusing exportCSV logic)
    let queryBuilder = db('records as r')
      .leftJoin('sites as s', 'r.site_id', 's.id')
      .leftJoin('instruments as i', 'r.instrument_id', 'i.id')
      .select('r.record_id', 's.code as site_code', 'r.status', 'r.created_at', 'r.data', 'i.name as instrument_name')
      .where('r.project_id', pid);

    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      queryBuilder = queryBuilder.where('r.entered_by', req.user.id);
    }

    const records = await queryBuilder.orderBy('r.record_id');

    let csvContent = 'Record_ID,Site_Code,Form_Name,Form_Status,Date_Created';

    const dynamicKeys = new Set();
    records.forEach(r => {
      const dataObj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {};
      Object.keys(dataObj).forEach(k => dynamicKeys.add(k));
    });

    const headerKeys = Array.from(dynamicKeys);
    headerKeys.forEach(k => {
      csvContent += `,${k}`;
    });
    csvContent += '\n';

    // Build subject ID anonymization mapping
    const recordIdMap = new Map();
    let nextSubjId = 1;
    if (deidentify) {
      records.forEach(r => {
        if (!recordIdMap.has(r.record_id)) {
          const paddedId = 'SUBJ_' + String(nextSubjId).padStart(3, '0');
          recordIdMap.set(r.record_id, paddedId);
          nextSubjId++;
        }
      });
    }

    // Populate rows
    records.forEach(r => {
      const dataObj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data || {};
      let dateStr = new Date(r.created_at).toISOString().split('T')[0];
      if (deidentify) {
        dateStr = '[REDACTED]';
      }
      const recId = deidentify ? recordIdMap.get(r.record_id) : r.record_id;
      let row = `"${recId}","${r.site_code || 'none'}","${r.instrument_name || 'unknown'}","${r.status}","${dateStr}"`;
      
      headerKeys.forEach(k => {
        let val = dataObj[k] !== undefined && dataObj[k] !== null ? dataObj[k] : '';
        if (deidentify && isPIIKey(k)) {
          val = '[REDACTED]';
        }
        const escaped = String(val).replace(/"/g, '""');
        row += `,"${escaped}"`;
      });
      csvContent += row + '\n';
    });

    // 2. Fetch all file attachments for the project
    let attachmentsQuery = db('attachments as a')
      .leftJoin('records as r', function() {
        this.on('a.project_id', '=', 'r.project_id')
            .andOn('a.record_id', '=', 'r.record_id')
            .andOn('a.instrument_id', '=', 'r.instrument_id');
      })
      .leftJoin('instruments as inst', 'a.instrument_id', 'inst.id')
      .select('a.*', 'inst.name as instrument_name')
      .where('a.project_id', pid);

    if (req.user.role === 'data_entry' || req.user.role === 'student') {
      attachmentsQuery = attachmentsQuery.where('r.entered_by', req.user.id);
    }

    const attachments = await attachmentsQuery;

    // 3. Generate manifest.json and manifest.csv
    const manifestJson = [];
    let manifestCsv = 'Record_ID,Instrument_Name,Field_ID,Original_FileName,Zip_FilePath,Uploaded_At\n';

    attachments.forEach(a => {
      const recId = deidentify ? (recordIdMap.get(a.record_id) || '[ANONYMIZED]') : a.record_id;
      const cleanFieldId = a.field_id || 'file';
      const cleanOriginalName = a.original_name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const zipPath = `files/${recId}/${cleanFieldId}_${cleanOriginalName}`;

      manifestJson.push({
        record_id: recId,
        instrument_name: a.instrument_name || 'unknown',
        field_id: a.field_id,
        original_name: a.original_name,
        zip_path: zipPath,
        uploaded_at: a.uploaded_at
      });

      const uploadedAtStr = a.uploaded_at ? (a.uploaded_at instanceof Date ? a.uploaded_at.toISOString() : new Date(a.uploaded_at).toISOString()) : '';
      manifestCsv += `"${recId}","${a.instrument_name || 'unknown'}","${a.field_id || ''}","${a.original_name.replace(/"/g, '""')}","${zipPath}","${uploadedAtStr}"\n`;
    });

    // 4. Initialize Archiver Stream
    res.setHeader('Content-Type', 'application/zip');
    res.attachment(`blde_project_${pid}_package.zip`);

    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.on('error', (err) => {
      logger.error(`Archiver error during ZIP export: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).send({ error: 'Failed to create zip package' });
      }
    });

    archive.pipe(res);

    // Append dataset.csv, manifest.json, manifest.csv
    archive.append(csvContent, { name: 'dataset.csv' });
    archive.append(JSON.stringify(manifestJson, null, 2), { name: 'manifest.json' });
    archive.append(manifestCsv, { name: 'manifest.csv' });

    // Append physical files
    const uploadsDir = env.uploads.dir;
    attachments.forEach(a => {
      const physicalPath = path.join(uploadsDir, a.filename);
      if (fs.existsSync(physicalPath)) {
        const recId = deidentify ? (recordIdMap.get(a.record_id) || '[ANONYMIZED]') : a.record_id;
        const cleanFieldId = a.field_id || 'file';
        const cleanOriginalName = a.original_name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const zipPath = `files/${recId}/${cleanFieldId}_${cleanOriginalName}`;
        
        archive.file(physicalPath, { name: zipPath });
      } else {
        logger.warn(`Attachment file missing on disk: ${physicalPath} (Mapped to: ${a.original_name})`);
      }
    });

    logger.info(`ZIP Export compiled for project ${pid} (De-identified: ${deidentify}) by ${req.user.email}`);

    await archive.finalize();

  } catch (error) {
    next(error);
  }
};
