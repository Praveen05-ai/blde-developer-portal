import db from '../../backend/src/db/connection.js';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('🧹 Clearing transaction tables...');
  await db('offline_queue').del();
  await db('rand_allocations').del();
  await db('rand_blocks').del();
  await db('rand_schemes').del();
  await db('dq_rules').del();
  await db('saved_reports').del();
  await db('alert_log').del();
  await db('alert_rules').del();
  await db('dde_records').del();
  await db('attachments').del();
  await db('patient_events').del();
  await db('survey_links').del();
  await db('audit_log').del();
  await db('project_users').del();
  await db('records').del();
  await db('event_instruments').del();
  await db('events').del();
  await db('instruments').del();
  await db('deliverable_downloads').del();
  await db('deliverables').del();
  await db('pilot_feedback').del();
  await db('support_tickets').del();
  await db('package_requests').del();
  await db('blueprint_requests').del();
  await db('projects').del();
  await db('activity_logs').del();
  await db('notifications').del();
  await db('internal_notes').del();
  await db('assignment_history').del();

  console.log('🧹 Cleaning users...');
  await db('users').update({ site_id: null });
  await db('sites').del();
  
  // Keep only admin@blde.ac.in
  await db('users')
    .whereNot({ email: 'admin@blde.ac.in' })
    .del();

  // Reset password to default installer credentials and enforce password reset on login
  const hashedPassword = bcrypt.hashSync('Admin@123', 10);
  await db('users')
    .where({ email: 'admin@blde.ac.in' })
    .update({ 
      password: hashedPassword,
      force_password_change: true,
      failed_login_attempts: 0,
      lockout_until: null,
      password_history: '[]'
    });

  console.log('✅ Database successfully cleared for fresh manual testing. Default credentials: admin@blde.ac.in / Admin@123');
  process.exit(0);
}

main().catch(err => {
  console.error('Error clearing database:', err);
  process.exit(1);
});
