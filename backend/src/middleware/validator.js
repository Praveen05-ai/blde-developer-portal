import db from '../db/connection.js';
import { logger } from '../config/logger.js';

export const validateClinicalData = async (req, res, next) => {
  let { instrument_id, data } = req.body;

  if (!instrument_id && req.params.id) {
    try {
      const rec = await db('records').where({ id: req.params.id }).first();
      if (rec) {
        instrument_id = rec.instrument_id;
      }
    } catch (err) {
      logger.error('Failed to resolve instrument_id in validation:', err);
    }
  }

  if (!instrument_id) {
    return res.status(400).json({ error: 'instrument_id is required' });
  }

  try {
    const inst = await db('instruments').where({ id: instrument_id }).first();
    if (!inst) {
      return res.status(404).json({ error: 'Instrument not found' });
    }

    const fields = typeof inst.fields === 'string' ? JSON.parse(inst.fields) : inst.fields;
    const errors = [];
    const payload = data || {};

    for (const field of fields) {
      const val = payload[field.id];
      
      // Skip validation if field is hidden by skip logic (branching)
      if (field.branching) {
        const { field: trigger, operator, value, action } = field.branching;
        const triggerValue = String(payload[trigger] || '');
        let isMatch = false;

        if (operator === '=') isMatch = triggerValue === String(value);
        else if (operator === '!=') isMatch = triggerValue !== String(value);
        else if (operator === '>') isMatch = parseFloat(triggerValue) > parseFloat(value);
        else if (operator === '<') isMatch = parseFloat(triggerValue) < parseFloat(value);

        const shouldHide = (action === 'show' && !isMatch) || (action === 'hide' && isMatch);
        if (shouldHide) {
          continue; // Hidden field - bypass constraints
        }
      }

      // 1. Required Validation
      if (field.required && (val === undefined || val === null || val === '')) {
        errors.push({ field: field.id, message: `"${field.label}" is required.` });
        continue;
      }

      if (val === undefined || val === null || val === '') {
        continue; // Optional field is empty
      }

      // 2. Numeric Range Validation
      if (field.validation?.type === 'range') {
        const num = parseFloat(val);
        const min = field.validation.min;
        const max = field.validation.max;

        if (isNaN(num)) {
          errors.push({ field: field.id, message: `"${field.label}" must be a valid number.` });
        } else {
          if (min !== undefined && num < min) {
            errors.push({ field: field.id, message: field.validation.message || `"${field.label}" minimum limit is ${min}.` });
          }
          if (max !== undefined && num > max) {
            errors.push({ field: field.id, message: field.validation.message || `"${field.label}" maximum limit is ${max}.` });
          }
        }
      }

      // 3. Regular Expression Format Validation
      if (field.validation?.type === 'regex') {
        try {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(String(val))) {
            errors.push({ field: field.id, message: field.validation.message || `"${field.label}" format is invalid.` });
          }
        } catch (err) {
          logger.error(`Invalid regex pattern configured on field ${field.id}: ${field.validation.pattern}`);
        }
      }

      // 4. Date Validation
      if (field.validation?.type === 'date') {
        const d = new Date(val);
        if (isNaN(d.getTime())) {
          errors.push({ field: field.id, message: `"${field.label}" is an invalid date.` });
        } else if (field.validation.maxToday && d > new Date()) {
          errors.push({ field: field.id, message: field.validation.message || `"${field.label}" cannot be in the future.` });
        }
      }
    }

    if (errors.length > 0) {
      return res.status(422).json({ errors });
    }

    next();
  } catch (error) {
    logger.error('Clinical validation engine failure:', error);
    res.status(500).json({ error: 'Internal validation pipeline failure' });
  }
};
