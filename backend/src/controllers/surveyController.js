import db from '../db/connection.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { recalculateCalculatedFields, triggerAlertRules } from './recordController.js';
import fs from 'fs';
import path from 'path';
import { validateFileSignature } from '../utils/fileValidator.js';

export const getSurveyDetails = async (req, res, next) => {
  const { token } = req.params;

  try {
    // 1. Try local survey_links table first (if not in central SaaS mode)
    if (env.deploymentMode !== 'saas') {
      const survey = await db('survey_links as s')
        .join('projects as p', 's.project_id', 'p.id')
        .join('instruments as i', 's.instrument_id', 'i.id')
        .select(
          's.*',
          'p.title as project_title',
          'p.deleted as project_deleted',
          'i.name as instrument_name',
          'i.fields as instrument_fields'
        )
        .where('s.token', token)
        .first();

      if (survey) {
        if (!survey.active || survey.project_deleted) {
          return res.status(404).json({ error: 'This survey is closed or no longer available.' });
        }

        if (survey.expires_at && new Date(survey.expires_at) < new Date()) {
          return res.status(410).json({ error: 'This survey link has expired.' });
        }

        const fields = typeof survey.instrument_fields === 'string' 
          ? JSON.parse(survey.instrument_fields) 
          : survey.instrument_fields || [];

        return res.json({
          id: survey.id,
          label: survey.label,
          project_title: survey.project_title,
          instrument: {
            id: survey.instrument_id,
            name: survey.instrument_name,
            fields
          }
        });
      }
    }

    // 2. Fall back to cloud_surveys for central server/relay mode
    const cloudSurvey = await db('cloud_surveys')
      .where('survey_token', token)
      .first();

    if (cloudSurvey) {
      if (!cloudSurvey.active) {
        return res.status(404).json({ error: 'This survey is closed or no longer available.' });
      }

      const fields = typeof cloudSurvey.schema_json === 'string' 
        ? JSON.parse(cloudSurvey.schema_json) 
        : cloudSurvey.schema_json || [];

      return res.json({
        id: cloudSurvey.client_local_survey_id,
        label: cloudSurvey.instrument_name || 'Patient Survey',
        project_title: cloudSurvey.project_title || 'BLDE(DU) Central Platform',
        instrument: {
          id: cloudSurvey.client_local_survey_id,
          name: cloudSurvey.instrument_name,
          fields
        }
      });
    }

    return res.status(404).json({ error: 'This survey is closed or no longer available.' });
  } catch (error) {
    next(error);
  }
};

export const submitSurveyResponse = async (req, res, next) => {
  const { token } = req.params;
  const { data } = req.body;

  try {
    // 1. Try local survey_links table first (if not in central SaaS mode)
    if (env.deploymentMode !== 'saas') {
      const survey = await db('survey_links as s')
        .join('projects as p', 's.project_id', 'p.id')
        .select('s.*', 'p.deleted as project_deleted')
        .where('s.token', token)
        .first();

      if (survey) {
        if (!survey.active || survey.project_deleted) {
          return res.status(404).json({ error: 'This survey is closed or no longer available.' });
        }

        if (survey.expires_at && new Date(survey.expires_at) < new Date()) {
          return res.status(410).json({ error: 'This survey link has expired.' });
        }

        const trx = await db.transaction();
        try {
          const existingCount = await trx('records')
            .where('record_id', 'like', 'SURV-%')
            .count('id as count')
            .first();
          const count = parseInt(existingCount.count || 0) + 1;
          const record_id = `SURV-${String(count).padStart(4, '0')}`;

          let parsedData = data || {};
          parsedData = await recalculateCalculatedFields(trx, survey.project_id, survey.instrument_id, parsedData);
          const dataPayload = JSON.stringify(parsedData);

          const [record] = await trx('records')
            .insert({
              project_id: survey.project_id,
              instrument_id: survey.instrument_id,
              record_id,
              event_id: null,
              site_id: null, // Public surveys do not map to specific researcher site
              repeat_instance: 1,
              data: dataPayload,
              status: 'complete',
              entered_by: survey.created_by || null
            })
            .returning('*');

          // Increment responses count
          await trx('survey_links')
            .where({ id: survey.id })
            .increment('responses', 1);

          // Audit trail logging
          await trx('audit_log').insert({
            project_id: survey.project_id,
            record_id,
            instrument_id: survey.instrument_id,
            user_id: survey.created_by || null,
            user_name: 'Public Survey Respondent',
            action: 'SURVEY_SUBMITTED',
            new_value: `Survey submission registered. Responses count: ${survey.responses + 1}`,
            ip_address: req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress
          });

          await triggerAlertRules(trx, survey.project_id, record_id, survey.instrument_id, parsedData);

          await trx.commit();
          logger.info(`Survey response submitted for project ${survey.project_id}, Record: ${record_id}`);
          
          return res.status(201).json({
            success: true,
            record_id,
            data: parsedData
          });
        } catch (error) {
          await trx.rollback();
          throw error;
        }
      }
    }

    // 2. Try central cloud_surveys table (relay buffer mode)
    const cloudSurvey = await db('cloud_surveys')
      .where('survey_token', token)
      .first();

    if (cloudSurvey) {
      if (!cloudSurvey.active) {
        return res.status(404).json({ error: 'This survey is closed or no longer available.' });
      }

      const responsePayload = typeof data === 'object' ? JSON.stringify(data) : data || '{}';

      await db('cloud_survey_responses')
        .insert({
          survey_token: token,
          response_data: responsePayload,
          synced: false,
          created_at: new Date()
        });

      logger.info(`✅ [CLOUD SURVEY SUBMIT] Synced/buffered response for survey token: ${token}`);
      return res.status(201).json({
        success: true,
        message: 'Response buffered successfully on central cloud server.'
      });
    }

    return res.status(404).json({ error: 'This survey is closed or no longer available.' });
  } catch (error) {
    next(error);
  }
};

export const uploadSurveyAttachment = async (req, res, next) => {
  const { token } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // 1. Verify survey token exists and is active
    let projectId = null;
    let clientLocalSurveyId = null;

    // Check local survey_links first
    if (env.deploymentMode !== 'saas') {
      const survey = await db('survey_links').where({ token, active: true }).first();
      if (survey) {
        projectId = survey.project_id;
        clientLocalSurveyId = survey.instrument_id;
      }
    }

    // Check cloud surveys
    if (!projectId) {
      const cloudSurvey = await db('cloud_surveys').where({ survey_token: token, active: true }).first();
      if (cloudSurvey) {
        projectId = 999999; // Mock/placeholder for central cloud uploads
        clientLocalSurveyId = cloudSurvey.client_local_survey_id;
      }
    }

    if (!projectId) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(404).json({ error: 'Survey not found or inactive' });
    }

    // 2. Validate file signature
    const fileBuffer = fs.readFileSync(file.path);
    const { valid, mime } = validateFileSignature(fileBuffer, file.originalname);
    if (!valid) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'File verification failed. Binary signature does not match file extension.' });
    }

    // 3. Save attachment details in central database (or local database)
    const [attachment] = await db('attachments')
      .insert({
        project_id: projectId,
        record_id: 'survey_buffer',
        instrument_id: clientLocalSurveyId,
        field_id: 'survey_field',
        filename: file.filename,
        original_name: file.originalname,
        mimetype: file.mimetype || mime,
        size: file.size,
        uploaded_by: null // anonymous
      })
      .returning('*');

    // 4. Return URL
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const fileUrl = `${protocol}://${host}/uploads/${file.filename}`;

    res.json({
      success: true,
      id: attachment.id,
      filename: file.filename,
      original_name: file.originalname,
      url: fileUrl
    });
  } catch (error) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    next(error);
  }
};
