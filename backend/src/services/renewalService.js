import db from '../db/connection.js';

/**
 * Runs periodic (daily) checks on active subscriptions.
 * Can be triggered via cron scheduler or API.
 */
export async function checkExpiringSubscriptions() {
  const now = new Date();
  const activeSubs = await db('subscriptions')
    .whereIn('status', ['active', 'expired'])
    .select('*');

  const logs = [];

  for (const sub of activeSubs) {
    if (!sub.end_date) continue; // Lifetime plans do not expire

    const expiry = new Date(sub.end_date);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // 1. Expiry Warnings (30, 15, 7, 1 day)
    if ([30, 15, 7, 1].includes(diffDays)) {
      // Check if we already logged this warning today
      const todayStr = now.toISOString().split('T')[0];
      const existingWarning = await db('billing_logs')
        .where({ subscription_id: sub.id, action: 'payment_pending' })
        .where('details', 'like', `%${diffDays} days remaining%`)
        .first();

      if (!existingWarning) {
        await db('billing_logs').insert({
          customer_id: sub.customer_id,
          subscription_id: sub.id,
          action: 'payment_pending',
          details: `Subscription warning: ${diffDays} days remaining before expiry (Expiry date: ${new Date(sub.end_date).toISOString().split('T')[0]}).`,
          created_at: new Date()
        });
        logs.push(`Logged ${diffDays}-day warning for Subscription #${sub.id}`);
      }
    }

    // 2. Grace Period & Expiry Handling
    if (diffDays <= 0) {
      const graceLimit = new Date(expiry.getTime() + (sub.grace_days || 7) * 24 * 3600 * 1000);
      
      if (now <= graceLimit) {
        // Still running under grace period
        // Check if grace_started has been logged
        const existingGraceLog = await db('billing_logs')
          .where({ subscription_id: sub.id, action: 'grace_started' })
          .first();

        if (!existingGraceLog) {
          await db('billing_logs').insert({
            customer_id: sub.customer_id,
            subscription_id: sub.id,
            action: 'grace_started',
            details: `Subscription expired on ${new Date(sub.end_date).toISOString().split('T')[0]}. Running under grace period of ${sub.grace_days} days.`,
            created_at: new Date()
          });

          // Mark license status as warning/active so it remains readable/writable but gives warning
          if (sub.license_id) {
            await db('licenses').where({ id: sub.license_id }).update({
              remote_status: 'warning',
              remote_status_reason: 'Subscription expired. Running under grace period.',
              updated_at: new Date()
            });
          }

          logs.push(`Subscription #${sub.id} entered grace period`);
        }
      } else {
        // Grace period fully expired
        if (sub.status !== 'expired') {
          // Update subscription status to expired
          await db('subscriptions').where({ id: sub.id }).update({
            status: 'expired',
            updated_at: new Date()
          });

          // Mark license as fully expired (triggers Read-Only mode)
          if (sub.license_id) {
            await db('licenses').where({ id: sub.license_id }).update({
              status: 'expired',
              remote_status: 'expired',
              remote_status_reason: 'Subscription expired and grace period elapsed. System locked to read-only.',
              updated_at: new Date()
            });

            await db('license_logs').insert({
              license_id: sub.license_id,
              action: 'expired_license',
              details: 'Subscription grace period expired. License deactivated. System locked to read-only.',
              timestamp: new Date()
            }).catch(() => {});
          }

          await db('billing_logs').insert({
            customer_id: sub.customer_id,
            subscription_id: sub.id,
            action: 'grace_expired',
            details: `Grace period for subscription #${sub.id} expired. Subscription is fully inactive.`,
            created_at: new Date()
          });

          await db('billing_logs').insert({
            customer_id: sub.customer_id,
            subscription_id: sub.id,
            action: 'subscription_expired',
            details: `Subscription #${sub.id} marked expired.`,
            created_at: new Date()
          });

          logs.push(`Subscription #${sub.id} grace period expired. Locked to read-only.`);
        }
      }
    }
  }

  return logs;
}
