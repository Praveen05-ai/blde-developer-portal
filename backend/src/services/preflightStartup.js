import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { db } from '../db/connection.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runtime } from '../config/runtimeConfig.js';

/**
 * Ordered startup preflight validator.
 * Validates config integrity, checksum locks, storage permissions, port bounds,
 * database connectivity, and migrations status synchronously on boot.
 */
export const runPreflightChecks = async () => {
  logger.info('==============================================================================');
  logger.info('           BLDE EDC — RESILIENT SYSTEM STARTUP PREFLIGHT AUDIT                ');
  logger.info('==============================================================================');

  const diagnostics = {
    configValid: false,
    checksumMatch: false,
    storageWritable: false,
    dbConnected: false,
    portAvailable: false,
    migrationsOk: false,
    timestamp: new Date().toISOString()
  };

  try {
    // -------------------------------------------------------------------------
    // Step 0: Public Key Integrity Pinning Check
    // -------------------------------------------------------------------------
    logger.info('🔍 [STEP 0/6] Verifying public key integrity fingerprint...');
    const publicKeyPaths = [
      path.resolve(process.cwd(), 'keys/public.pem'),
      path.resolve(process.cwd(), '../keys/public.pem'),
    ];
    let publicKeyPath = null;
    for (const p of publicKeyPaths) {
      if (fs.existsSync(p)) {
        publicKeyPath = p;
        break;
      }
    }
    if (!publicKeyPath) {
      throw new Error(`CRITICAL INTEGRITY ERROR: Public key file public.pem not found.`);
    }
    const rawPublicKey = fs.readFileSync(publicKeyPath, 'utf8');
    const cleanPublicKey = rawPublicKey.replace(/\r\n/g, '\n').trim();
    const publicKeyHash = crypto.createHash('sha256').update(cleanPublicKey).digest('hex');
    if (publicKeyHash !== 'fb57764ebd588af5c9ea8e2cc20ab1709aff656573bbdc5cf61ca6fb3a240c62') {
      throw new Error(`CRITICAL INTEGRITY ERROR: Public key fingerprint mismatch.`);
    }
    logger.info('   -> Success: Public key integrity check passed.');

    // -------------------------------------------------------------------------
    // Step 1: Centralized Configuration schema checks
    // -------------------------------------------------------------------------
    logger.info('🔍 [STEP 1/6] Evaluating runtime.json config authority schema...');
    if (!runtime || !runtime.deployment_profile) {
      throw new Error('Centralized runtime.json authority is missing or corrupted.');
    }
    diagnostics.configValid = true;
    logger.info('   -> Success: Authority schema validated.');

    // -------------------------------------------------------------------------
    // Step 2: SHA-256 Checksum validation
    // -------------------------------------------------------------------------
    logger.info('🔍 [STEP 2/6] Verifying configuration SHA-256 tamper lock signature...');
    // We already do the checksum lock validation synchronously inside runtimeConfig.js.
    // If it reaches here, the import of runtimeConfig has already passed the check!
    diagnostics.checksumMatch = true;
    logger.info('   -> Success: Configuration signature verified.');

    // -------------------------------------------------------------------------
    // Step 3: Standardized Storage writability checks
    // -------------------------------------------------------------------------
    logger.info('🔍 [STEP 3/6] Probing persistent storage folder writability bindings...');
    // runtimeConfig.js also executes folder creation and writability probes synchronously on boot.
    // We add an explicit runtime assert here to confirm.
    Object.entries(runtime.storagePaths).forEach(([name, p]) => {
      const testFile = path.join(p, `.preflight_${crypto.randomBytes(4).toString('hex')}`);
      try {
        fs.writeFileSync(testFile, 'PREFLIGHT_OK', 'utf8');
        fs.unlinkSync(testFile);
      } catch (err) {
        throw new Error(`Directory for ${name} at ${p} has restricted write access: ${err.message}`);
      }
    });
    diagnostics.storageWritable = true;
    logger.info('   -> Success: All persistent volumes are fully writable.');

    // -------------------------------------------------------------------------
    // Step 4: Database availability
    // -------------------------------------------------------------------------
    logger.info(`🔍 [STEP 4/6] Connecting to database dialect [client: ${env.db.client}]...`);
    try {
      await db.raw('SELECT 1');
      diagnostics.dbConnected = true;
      logger.info('   -> Success: Socket connection established and database responds.');
    } catch (err) {
      throw new Error(`Database connection failed: ${err.message}`);
    }

    // -------------------------------------------------------------------------
    // Step 5: Port availability
    // -------------------------------------------------------------------------
    logger.info(`🔍 [STEP 5/6] Probing host network port binding availability [port: ${env.port}]...`);
    await new Promise((resolve, reject) => {
      const testServer = net.createServer();
      testServer.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${env.port} is already locked by another process.`));
        } else {
          reject(err);
        }
      });
      testServer.once('listening', () => {
        testServer.close(() => resolve());
      });
      testServer.listen(env.port, env.host);
    });
    diagnostics.portAvailable = true;
    logger.info('   -> Success: Host port is free for Express socket binding.');

    // -------------------------------------------------------------------------
    // Step 6: Knex Migrations Compatibility
    // -------------------------------------------------------------------------
    logger.info('🔍 [STEP 6/6] Auditing database schema migrations status...');
    try {
      logger.info('   Auto-executing sequential migrations to check and update database schema...');
      await db.migrate.latest();
      logger.info('   -> Success: Database is fully migrated and structural schemas are up to date.');

      // GxP Self-healing check for default consultants
      logger.info('🔍 Self-healing: Checking default consultants status...');
      const consultantsCount = await db('consultants').count('id as cnt').first();
      if (parseInt(consultantsCount?.cnt || '0', 10) === 0) {
        logger.info('   🌱 Seeding default consultants for Research Assistant...');
        const consultants = [
          { name: 'Dr. Sharan Patil', email: 'patil.sharan@blde.ac.in', role: 'consultant', active: true },
          { name: 'Prof. Anita G.', email: 'anita.g@blde.ac.in', role: 'statistician', active: true },
          { name: 'Dr. Suresh K.', email: 'suresh.k@blde.ac.in', role: 'ai_engineer', active: true },
          { name: 'Amit Kumar', email: 'kumar.amit@blde.ac.in', role: 'db_operator', active: true },
          { name: 'Vani K.', email: 'vani.k@blde.ac.in', role: 'qa', active: true }
        ];
        await db('consultants').insert(consultants);
        logger.info('   -> Success: Seeding completed.');
      } else {
        logger.info('   -> Success: Default consultants already present.');
      }

      // Self-healing check to assign default organization ID to imported projects
      logger.info('🔍 Self-healing: Checking for orphaned projects with null organization ID...');
      const updatedCount = await db('projects').whereNull('organization_id').update({ organization_id: 1 });
      if (updatedCount > 0) {
        logger.info(`   -> Success: Associated ${updatedCount} orphaned project(s) with default organization ID 1.`);
      } else {
        logger.info('   -> Success: No orphaned projects found.');
      }

      // Self-healing check to ensure 'customers' table has all required columns
      logger.info('🔍 Self-healing: Checking customers table schema integrity...');
      const hasCustomersTable = await db.schema.hasTable('customers');
      if (hasCustomersTable) {
        if (!await db.schema.hasColumn('customers', 'customer_id')) {
          logger.info('   ⚙️ Adding missing "customer_id" column...');
          await db.schema.alterTable('customers', (table) => { table.string('customer_id').unique().nullable(); });
        }
        if (!await db.schema.hasColumn('customers', 'contact_person')) {
          logger.info('   ⚙️ Adding missing "contact_person" column...');
          await db.schema.alterTable('customers', (table) => { table.string('contact_person').nullable(); });
        }
        if (!await db.schema.hasColumn('customers', 'email')) {
          logger.info('   ⚙️ Adding missing "email" column...');
          await db.schema.alterTable('customers', (table) => { table.string('email').nullable(); });
        }
        if (!await db.schema.hasColumn('customers', 'mobile')) {
          logger.info('   ⚙️ Adding missing "mobile" column...');
          await db.schema.alterTable('customers', (table) => { table.string('mobile').nullable(); });
        }
        if (!await db.schema.hasColumn('customers', 'notes')) {
          logger.info('   ⚙️ Adding missing "notes" column...');
          await db.schema.alterTable('customers', (table) => { table.text('notes').nullable(); });
        }
        if (!await db.schema.hasColumn('customers', 'archived')) {
          logger.info('   ⚙️ Adding missing "archived" column...');
          await db.schema.alterTable('customers', (table) => { table.boolean('archived').defaultTo(false); });
        }
        logger.info('   -> Success: Customers table schema is intact.');
      }

      // Self-healing check to ensure 'licenses' table has all required columns
      logger.info('🔍 Self-healing: Checking licenses table schema integrity...');
      const hasLicensesTable = await db.schema.hasTable('licenses');
      if (hasLicensesTable) {
        if (!await db.schema.hasColumn('licenses', 'license_id_str')) {
          logger.info('   ⚙️ Adding missing "license_id_str" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('license_id_str').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'license_version')) {
          logger.info('   ⚙️ Adding missing "license_version" column...');
          await db.schema.alterTable('licenses', (table) => { table.integer('license_version').defaultTo(1); });
        }
        if (!await db.schema.hasColumn('licenses', 'parent_license_id')) {
          logger.info('   ⚙️ Adding missing "parent_license_id" column...');
          await db.schema.alterTable('licenses', (table) => { table.integer('parent_license_id').references('id').inTable('licenses').onDelete('SET NULL').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'customer_id')) {
          logger.info('   ⚙️ Adding missing "customer_id" column...');
          await db.schema.alterTable('licenses', (table) => { table.integer('customer_id').references('id').inTable('customers').onDelete('SET NULL').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'machine_name')) {
          logger.info('   ⚙️ Adding missing "machine_name" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('machine_name').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'last_validation_date')) {
          logger.info('   ⚙️ Adding missing "last_validation_date" column...');
          await db.schema.alterTable('licenses', (table) => { table.timestamp('last_validation_date').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'notes')) {
          logger.info('   ⚙️ Adding missing "notes" column...');
          await db.schema.alterTable('licenses', (table) => { table.text('notes').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'subscription_plan')) {
          logger.info('   ⚙️ Adding missing "subscription_plan" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('subscription_plan').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'payment_status')) {
          logger.info('   ⚙️ Adding missing "payment_status" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('payment_status').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'amount')) {
          logger.info('   ⚙️ Adding missing "amount" column...');
          await db.schema.alterTable('licenses', (table) => { table.decimal('amount', 10, 2).nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'currency')) {
          logger.info('   ⚙️ Adding missing "currency" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('currency').nullable(); });
        }
        if (!await db.schema.hasColumn('licenses', 'invoice_number')) {
          logger.info('   ⚙️ Adding missing "invoice_number" column...');
          await db.schema.alterTable('licenses', (table) => { table.string('invoice_number').nullable(); });
        }
        logger.info('   -> Success: Licenses table schema is intact.');
      }

      diagnostics.migrationsOk = true;
    } catch (err) {
      throw new Error(`Database migration audit failed: ${err.message}`);
    }

    logger.info('==============================================================================');
    logger.info('🎉 ALL PREFLIGHT AUDIT VALIDATIONS PASSED! System is safe to boot.');
    logger.info('==============================================================================\n');
    return diagnostics;

  } catch (err) {
    logger.error('==============================================================================');
    logger.error(`❌ CRITICAL STARTUP PREFLIGHT FAULT: ${err.message}`);
    logger.error('==============================================================================');
    logger.error('System boot halted safely. Diagnostic metrics details logged.');
    
    // Allow Winston logs to write before exit
    setTimeout(() => {
      process.exit(1);
    }, 100);
    
    throw err;
  }
};

export default runPreflightChecks;
