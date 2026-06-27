import db from '../db/connection.js';

export async function getRevenueSummary(req, res) {
  try {
    const paidInvoices = await db('invoices').where({ status: 'paid' }).select('amount', 'issue_date');
    
    let totalRevenue = 0;
    const monthlyRevenue = {};

    paidInvoices.forEach(inv => {
      const amt = parseFloat(inv.amount);
      totalRevenue += amt;

      const date = new Date(inv.issue_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + amt;
    });

    return res.json({
      totalRevenue,
      monthlyBreakdown: monthlyRevenue
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPendingInvoices(req, res) {
  try {
    const pending = await db('invoices')
      .join('customers', 'invoices.customer_id', 'customers.id')
      .whereIn('invoices.status', ['unpaid', 'overdue'])
      .select('invoices.*', 'customers.name as customer_name', 'customers.organization')
      .orderBy('invoices.due_date', 'asc');
    return res.json(pending);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getExpiredSubscriptions(req, res) {
  try {
    const now = new Date();
    const expired = await db('subscriptions')
      .join('customers', 'subscriptions.customer_id', 'customers.id')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .where('subscriptions.status', 'expired')
      .orWhere(function() {
        this.whereNotNull('subscriptions.end_date').andWhere('subscriptions.end_date', '<', now);
      })
      .select('subscriptions.*', 'customers.name as customer_name', 'subscription_plans.plan_name')
      .orderBy('subscriptions.end_date', 'desc');
    return res.json(expired);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getPaymentHistory(req, res) {
  try {
    const history = await db('payments')
      .join('invoices', 'payments.invoice_id', 'invoices.id')
      .join('customers', 'invoices.customer_id', 'customers.id')
      .select('payments.*', 'invoices.invoice_number', 'customers.name as customer_name')
      .orderBy('payments.payment_date', 'desc');
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getBillingLogs(req, res) {
  try {
    const { action } = req.query;
    let query = db('billing_logs')
      .join('customers', 'billing_logs.customer_id', 'customers.id')
      .leftJoin('subscriptions', 'billing_logs.subscription_id', 'subscriptions.id')
      .leftJoin('invoices', 'billing_logs.invoice_id', 'invoices.id')
      .leftJoin('payments', 'billing_logs.payment_id', 'payments.id')
      .select(
        'billing_logs.*',
        'customers.name as customer_name',
        'invoices.invoice_number',
        'subscriptions.subscription_version'
      )
      .orderBy('billing_logs.id', 'desc');

    if (action) {
      query = query.where('billing_logs.action', action);
    }

    const logs = await query;
    return res.json(logs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
