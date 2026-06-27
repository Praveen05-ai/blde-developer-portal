import db from '../db/connection.js';
import { activateLicenseForSubscription } from './subscriptionService.js';

/**
 * Records a pending payment for an invoice.
 */
export async function recordPayment(invoiceId, paymentDetails) {
  const invoice = await db('invoices').where({ id: invoiceId }).first();
  if (!invoice) throw new Error('Invoice not found');

  const [paymentId] = await db('payments').insert({
    invoice_id: invoiceId,
    transaction_reference: paymentDetails.transaction_reference || `TXN-PENDING-${invoiceId}-${Date.now()}`,
    amount: invoice.amount,
    currency: invoice.currency,
    payment_date: paymentDetails.payment_date ? new Date(paymentDetails.payment_date) : new Date(),
    payment_method: paymentDetails.payment_method || 'UPI',
    status: 'pending',
    notes: paymentDetails.notes || null,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('id');

  const paymentIdVal = typeof paymentId === 'object' ? (paymentId.id || Object.values(paymentId)[0]) : paymentId;

  return await db('payments').where({ id: paymentIdVal }).first();
}

/**
 * Marks payment as successful, activates the subscription & license, and updates renewal status.
 */
export async function markPaymentSuccess(paymentId, transactionReference) {
  const payment = await db('payments').where({ id: paymentId }).first();
  if (!payment) throw new Error('Payment not found');

  // Update payment status
  await db('payments').where({ id: paymentId }).update({
    status: 'success',
    transaction_reference: transactionReference || payment.transaction_reference,
    updated_at: new Date()
  });

  // Update invoice status
  await db('invoices').where({ id: payment.invoice_id }).update({
    status: 'paid',
    payment_method: payment.payment_method,
    updated_at: new Date()
  });

  const invoice = await db('invoices').where({ id: payment.invoice_id }).first();
  const sub = await db('subscriptions').where({ id: invoice.subscription_id }).first();

  // Activate subscription
  const start = new Date();
  const plan = await db('subscription_plans').where({ id: sub.plan_id }).first();
  let end = null;
  if (plan.duration_days && plan.duration_days < 99999) {
    end = new Date(start.getTime() + plan.duration_days * 24 * 3600 * 1000);
  }

  await db('subscriptions').where({ id: sub.id }).update({
    status: 'active',
    start_date: start,
    end_date: end,
    renewal_date: end,
    updated_at: new Date()
  });

  // Activate license key
  const licenseId = await activateLicenseForSubscription(sub.id);

  // If this is a renewal (version > 1), mark the parent subscription as 'renewed'
  if (sub.parent_subscription_id) {
    await db('subscriptions').where({ id: sub.parent_subscription_id }).update({
      status: 'renewed',
      updated_at: new Date()
    });

    // Write renewal success log
    await db('billing_logs').insert({
      customer_id: sub.customer_id,
      subscription_id: sub.id,
      invoice_id: invoice.id,
      payment_id: paymentId,
      action: 'renewal_success',
      details: `Subscription renewed successfully to version ${sub.subscription_version}. Plan: ${plan.plan_name}. New expiry: ${end ? end.toISOString().split('T')[0] : 'Lifetime'}`,
      created_at: new Date()
    });
  } else {
    // Write payment received log
    await db('billing_logs').insert({
      customer_id: sub.customer_id,
      subscription_id: sub.id,
      invoice_id: invoice.id,
      payment_id: paymentId,
      action: 'payment_received',
      details: `Payment of ${payment.currency} ${payment.amount} received successfully. Subscription activated.`,
      created_at: new Date()
    });
  }

  return await db('payments').where({ id: paymentId }).first();
}

/**
 * Marks payment as failed.
 */
export async function markPaymentFailed(paymentId, notes) {
  const payment = await db('payments').where({ id: paymentId }).first();
  if (!payment) throw new Error('Payment not found');

  await db('payments').where({ id: paymentId }).update({
    status: 'failed',
    notes: notes || 'Payment failed',
    updated_at: new Date()
  });

  const invoice = await db('invoices').where({ id: payment.invoice_id }).first();
  const sub = await db('subscriptions').where({ id: invoice.subscription_id }).first();

  await db('billing_logs').insert({
    customer_id: sub.customer_id,
    subscription_id: sub.id,
    invoice_id: invoice.id,
    payment_id: paymentId,
    action: 'renewal_failure',
    details: `Payment transaction failed. Reason: ${notes || 'Transaction declined.'}`,
    created_at: new Date()
  });

  return await db('payments').where({ id: paymentId }).first();
}

/**
 * Refunds a successful payment.
 */
export async function refundPayment(paymentId, notes) {
  const payment = await db('payments').where({ id: paymentId }).first();
  if (!payment) throw new Error('Payment not found');

  await db('payments').where({ id: paymentId }).update({
    status: 'refunded',
    notes: notes || 'Payment refunded',
    updated_at: new Date()
  });

  const invoice = await db('invoices').where({ id: payment.invoice_id }).first();
  await db('invoices').where({ id: payment.invoice_id }).update({
    status: 'cancelled',
    notes: `Refunded: ${notes || 'Payment refunded'}`,
    updated_at: new Date()
  });

  const sub = await db('subscriptions').where({ id: invoice.subscription_id }).first();
  await db('subscriptions').where({ id: invoice.subscription_id }).update({
    status: 'cancelled',
    notes: `Refunded: ${notes || 'Payment refunded'}`,
    updated_at: new Date()
  });

  // Deactivate linked license
  if (sub.license_id) {
    await db('licenses').where({ id: sub.license_id }).update({
      status: 'suspended',
      remote_status: 'suspended',
      remote_status_reason: 'Payment refunded.',
      updated_at: new Date()
    });
  }

  await db('billing_logs').insert({
    customer_id: sub.customer_id,
    subscription_id: sub.id,
    invoice_id: invoice.id,
    payment_id: paymentId,
    action: 'refund_processed',
    details: `Refund processed. Amount: ${payment.currency} ${payment.amount}. Subscription cancelled.`,
    created_at: new Date()
  });

  return await db('payments').where({ id: paymentId }).first();
}
