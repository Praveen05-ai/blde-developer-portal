import db from '../db/connection.js';
import * as invService from '../services/invoiceService.js';

export async function getInvoices(req, res) {
  try {
    const invoices = await db('invoices')
      .join('customers', 'invoices.customer_id', 'customers.id')
      .join('subscriptions', 'invoices.subscription_id', 'subscriptions.id')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .select(
        'invoices.*',
        'customers.name as customer_name',
        'customers.organization as customer_organization',
        'subscription_plans.plan_name'
      )
      .orderBy('invoices.id', 'desc');
    return res.json(invoices);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function generateInvoice(req, res) {
  try {
    const { subscription_id, notes } = req.body;
    if (!subscription_id) {
      return res.status(400).json({ error: 'subscription_id is required.' });
    }

    const invoice = await invService.generateInvoice(subscription_id, { notes });
    return res.status(201).json(invoice);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function downloadInvoice(req, res) {
  try {
    const { id } = req.params;
    const pdfBuffer = await invService.downloadInvoicePdf(id);
    const invoice = await db('invoices').where({ id }).first();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${invoice?.invoice_number || id}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function cancelInvoice(req, res) {
  try {
    const { id } = req.params;
    
    await db('invoices').where({ id }).update({
      status: 'cancelled',
      updated_at: new Date()
    });

    const invoice = await db('invoices').where({ id }).first();

    await db('billing_logs').insert({
      customer_id: invoice.customer_id,
      subscription_id: invoice.subscription_id,
      invoice_id: id,
      action: 'invoice_cancelled',
      details: `Invoice ${invoice.invoice_number} cancelled manually.`,
      created_at: new Date()
    });

    return res.json({ success: true, message: 'Invoice cancelled successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
