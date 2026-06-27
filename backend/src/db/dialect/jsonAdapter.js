/**
 * Clinical Database JSON Abstraction Layer
 * Abstracts dialect-specific JSON storage behaviors to protect GxP code-portability.
 */

/**
 * Normalizes JSON data format for database write operations.
 * - PostgreSQL handles JSONB structures natively.
 */
export const normalizeJsonForWrite = (data) => {
  if (data === undefined || data === null) return null;
  return data;
};

/**
 * Normalizes JSON data format for read operations.
 * - If the column returns a string representation, parses it cleanly.
 * - If already mapped to an object (PostgreSQL), returns directly.
 */
export const normalizeJsonForRead = (data) => {
  if (data === undefined || data === null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (e) {
      return data;
    }
  }
  return data;
};

/**
 * Resolves a specific key value nested inside a JSON column.
 * @param {Object} obj The row object returned from the database
 * @param {string} column The column name storing the JSON payload
 * @param {string|null} path Dot-separated path inside the JSON object (e.g. "profile.age")
 */
export const getJsonField = (obj, column, path = null) => {
  if (!obj || obj[column] === undefined || obj[column] === null) return null;
  const data = normalizeJsonForRead(obj[column]);
  if (!path) return data;
  
  return path.split('.').reduce((acc, part) => {
    return (acc && acc[part] !== undefined) ? acc[part] : null;
  }, data);
};

/**
 * Immutably updates or sets a specific key inside a JSON database payload.
 */
export const setJsonField = (obj, column, path, value) => {
  const currentData = getJsonField(obj, column) || {};
  const keys = path.split('.');
  
  // Clone currentData recursively to protect original object references
  const updatedData = JSON.parse(JSON.stringify(currentData));
  
  let temp = updatedData;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (temp[key] === undefined || temp[key] === null || typeof temp[key] !== 'object') {
      temp[key] = {};
    }
    temp = temp[key];
  }
  temp[keys[keys.length - 1]] = value;
  
  return normalizeJsonForWrite(updatedData);
};

/**
 * Builds dialect-agnostic Knex where clause searching inside JSON columns.
 * - PostgreSQL uses: column#>>'{path}' = value
 */
export const searchJsonField = (queryBuilder, column, path, operator, val) => {
  const parts = path.split('.');
  const pgPath = `{${parts.join(',')}}`;
  return queryBuilder.whereRaw(`${column}#>>? ${operator} ?`, [pgPath, String(val)]);
};

export default {
  normalizeJsonForWrite,
  normalizeJsonForRead,
  getJsonField,
  setJsonField,
  searchJsonField
};
