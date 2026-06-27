import jsonAdapter from './jsonAdapter.js';

export const dialect = {
  // JSON Abstraction methods
  normalizeJsonForWrite: jsonAdapter.normalizeJsonForWrite,
  normalizeJsonForRead: jsonAdapter.normalizeJsonForRead,
  getJsonField: jsonAdapter.getJsonField,
  setJsonField: jsonAdapter.setJsonField,
  searchJsonField: jsonAdapter.searchJsonField,
  
  // Normalization Helpers (GxP Dialect Compatibility)
  normalizeBoolean: (val) => {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    return val === 1 || String(val).toLowerCase() === 'true';
  },
  
  normalizeTimestamp: (val) => {
    if (!val) return null;
    return new Date(val).toISOString();
  }
};

export default dialect;
