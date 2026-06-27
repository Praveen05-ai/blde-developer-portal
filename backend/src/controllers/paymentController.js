import db from '../db/connection.js';
import * as payService from '../services/paymentService.js';

export async function getPayments(req, res) {
  try {
    const payments = await db('payments')
      .join('invoices', 'payments.invoice_id', 'invoices.id')
      .join('customers', 'invoices.customer_id', 'customers.id')
      .select(
        'payments.*',
        'invoices.invoice_number',
        'customers.name as customer_name'
      )
      .orderBy('payments.id', 'desc');
    return res.json(payments);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function recordPayment(req, res) {
  try {
    const { invoice_id, transaction_reference, payment_method, status, notes, payment_date } = req.body;
    if (!invoice_id || !payment_method) {
      return res.status(400).json({ error: 'invoice_id and payment_method are required.' });
    }

    const payData = {
      transaction_reference,
      payment_method,
      notes,
      payment_date
    };

    let payment = await payService.recordPayment(invoice_id, payData);

    if (status === 'success') {
      payment = await payService.markPaymentSuccess(payment.id, transaction_reference);
    } else if (status === 'failed') {
      payment = await payService.markPaymentFailed(payment.id, notes || 'Payment failed on record');
    }

    return res.status(201).json(payment);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function refundPayment(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const payment = await payService.refundPayment(id, notes);
    return res.json(payment);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
