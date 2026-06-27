import { env } from './src/config/env.js';

const connection = {
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.name,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false
    };

const pool = {
      min: 2,
      max: 10
    };

export default {
  development: {
    client: 'pg',
    connection,
    pool,
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations',
      extension: 'js',
      loadExtensions: ['.js']
    },
    seeds: {
      directory: './db/seeds'
    }
  },
  production: {
    client: 'pg',
    connection,
    pool,
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: './db/seeds'
    }
  }
};
