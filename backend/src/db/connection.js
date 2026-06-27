import knex from 'knex';
import knexConfig from '../../knexfile.js';
import { env } from '../config/env.js';

const environment = env.nodeEnv || 'development';
const config = knexConfig[environment];

export const db = knex(config);
export default db;
