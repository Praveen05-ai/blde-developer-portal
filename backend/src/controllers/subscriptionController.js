import db from '../db/connection.js';
import * as subService from '../services/subscriptionService.js';

// ── PLAN MANAGEMENT ──

export async function getPlans(req, res) {
  try {
    const plans = await db('subscription_plans').orderBy('id', 'asc');
    return res.json(plans);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createPlan(req, res) {
  try {
    const {
      plan_code, plan_name, license_type, duration_days, amount, currency,
      max_projects, max_users, max_forms, max_records, max_storage_gb, max_upload_mb, max_sessions
    } = req.body;

    if (!plan_code || !plan_name || !license_type || amount === undefined) {
      return res.status(400).json({ error: 'plan_code, plan_name, license_type, and amount are required.' });
    }

    const [id] = await db('subscription_plans').insert({
      plan_code,
      plan_name,
      license_type,
      duration_days: duration_days === null ? null : parseInt(duration_days, 10),
      amount: parseFloat(amount),
      currency: currency || 'INR',
      max_projects: max_projects !== undefined ? max_projects : null,
      max_users: max_users !== undefined ? max_users : null,
      max_forms: max_forms !== undefined ? max_forms : null,
      max_records: max_records !== undefined ? max_records : null,
      max_storage_gb: max_storage_gb !== undefined ? max_storage_gb : null,
      max_upload_mb: max_upload_mb !== undefined ? max_upload_mb : null,
      max_sessions: max_sessions !== undefined ? max_sessions : null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('id');

    const idVal = typeof id === 'object' ? (id.id || Object.values(id)[0]) : id;
    const plan = await db('subscription_plans').where({ id: idVal }).first();
    return res.status(201).json(plan);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updatePlan(req, res) {
  try {
    const { id } = req.params;
    const {
      plan_name, license_type, duration_days, amount, currency,
      max_projects, max_users, max_forms, max_records, max_storage_gb, max_upload_mb, max_sessions, is_active
    } = req.body;

    await db('subscription_plans').where({ id }).update({
      plan_name,
      license_type,
      duration_days: duration_days === null ? null : parseInt(duration_days, 10),
      amount: amount !== undefined ? parseFloat(amount) : undefined,
      currency,
      max_projects,
      max_users,
      max_forms,
      max_records,
      max_storage_gb,
      max_upload_mb,
      max_sessions,
      is_active,
      updated_at: new Date()
    });

    const plan = await db('subscription_plans').where({ id }).first();
    return res.json(plan);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function archivePlan(req, res) {
  try {
    const { id } = req.params;
    await db('subscription_plans').where({ id }).update({ is_active: false, updated_at: new Date() });
    return res.json({ success: true, message: 'Plan deactivated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── SUBSCRIPTION MANAGEMENT ──

export async function getSubscriptions(req, res) {
  try {
    const subs = await db('subscriptions')
      .join('customers', 'subscriptions.customer_id', 'customers.id')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .leftJoin('licenses', 'subscriptions.license_id', 'licenses.id')
      .select(
        'subscriptions.*',
        'customers.name as customer_name',
        'customers.organization as customer_organization',
        'subscription_plans.plan_name',
        'subscription_plans.plan_code',
        'licenses.license_id_str'
      )
      .orderBy('subscriptions.id', 'desc');

    const enriched = subs.map(s => ({
      ...s,
      remaining_days: subService.calculateRemainingDays(s)
    }));

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createSubscription(req, res) {
  try {
    const { customer_id, plan_id, auto_renew, grace_days, notes, start_date } = req.body;
    if (!customer_id || !plan_id) {
      return res.status(400).json({ error: 'customer_id and plan_id are required.' });
    }

    const sub = await subService.createSubscription(customer_id, plan_id, {
      auto_renew,
      grace_days,
      notes,
      start_date
    });

    return res.status(201).json(sub);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function renewSubscription(req, res) {
  try {
    const { id } = req.params;
    const { plan_id, notes } = req.body;

    const sub = await subService.renewSubscription(id, {
      planId: plan_id,
      notes
    });

    return res.json(sub);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function extendSubscription(req, res) {
  try {
    const { id } = req.params;
    const { days } = req.body;
    if (!days || isNaN(days)) {
      return res.status(400).json({ error: 'Valid days extension is required.' });
    }

    const sub = await subService.extendSubscription(id, parseInt(days, 10));
    return res.json(sub);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function cancelSubscription(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const sub = await subService.cancelSubscription(id, { notes });
    return res.json(sub);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getExpiringSubscriptions(req, res) {
  try {
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // 30 days

    const subs = await db('subscriptions')
      .join('customers', 'subscriptions.customer_id', 'customers.id')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .where('subscriptions.status', 'active')
      .where('subscriptions.end_date', '>=', now)
      .where('subscriptions.end_date', '<=', threshold)
      .select(
        'subscriptions.*',
        'customers.name as customer_name',
        'subscription_plans.plan_name'
      )
      .orderBy('subscriptions.end_date', 'asc');

    const enriched = subs.map(s => ({
      ...s,
      remaining_days: subService.calculateRemainingDays(s)
    }));

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getGraceModeCustomers(req, res) {
  try {
    const now = new Date();
    
    // Grace mode customers are active or expired subscriptions past end_date but within grace_days
    const subs = await db('subscriptions')
      .join('customers', 'subscriptions.customer_id', 'customers.id')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .whereNotNull('subscriptions.end_date')
      .where('subscriptions.end_date', '<', now)
      .select(
        'subscriptions.*',
        'customers.name as customer_name',
        'subscription_plans.plan_name'
      );

    const graceList = [];
    for (const s of subs) {
      const expiry = new Date(s.end_date);
      const graceLimit = new Date(expiry.getTime() + (s.grace_days || 7) * 24 * 3600 * 1000);
      if (now <= graceLimit) {
        graceList.push({
          ...s,
          remaining_grace_days: Math.ceil((graceLimit - now) / (1000 * 3600 * 24))
        });
      }
    }

    return res.json(graceList);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
