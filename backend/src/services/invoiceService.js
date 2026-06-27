import db from '../db/connection.js';

/**
 * Generates an invoice for a subscription.
 */
export async function generateInvoice(subscriptionId, options = {}) {
  const sub = await db('subscriptions').where({ id: subscriptionId }).first();
  if (!sub) throw new Error('Subscription not found');

  const plan = await db('subscription_plans').where({ id: sub.plan_id }).first();
  if (!plan) throw new Error('Plan not found');

  const customer = await db('customers').where({ id: sub.customer_id }).first();
  if (!customer) throw new Error('Customer not found');

  // Generate sequence number
  const invoiceNumber = await generateInvoiceNumber();

  const issueDate = options.issue_date ? new Date(options.issue_date) : new Date();
  const dueDate = new Date(issueDate.getTime() + 7 * 24 * 3600 * 1000); // 7 days payment terms

  const [invId] = await db('invoices').insert({
    invoice_number: invoiceNumber,
    customer_id: sub.customer_id,
    subscription_id: subscriptionId,
    amount: plan.amount,
    currency: plan.currency || 'INR',
    issue_date: issueDate,
    due_date: dueDate,
    status: 'unpaid',
    payment_method: null,
    notes: options.notes || `Invoice for ${plan.plan_name} plan`,
    created_at: new Date(),
    updated_at: new Date()
  }).returning('id');

  const invIdVal = typeof invId === 'object' ? (invId.id || Object.values(invId)[0]) : invId;

  // Log invoice creation
  await db('billing_logs').insert({
    customer_id: sub.customer_id,
    subscription_id: subscriptionId,
    invoice_id: invIdVal,
    action: 'invoice_created',
    details: `Invoice ${invoiceNumber} generated for amount ${plan.currency} ${plan.amount}`,
    created_at: new Date()
  });

  return await db('invoices').where({ id: invIdVal }).first();
}

/**
 * Generates a sequential invoice number: INV-2026-000001, etc.
 */
export async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const countRecord = await db('invoices').count('id as count').first();
  const nextSeq = parseInt(countRecord.count || 0, 10) + 1;
  return `INV-${year}-${String(nextSeq).padStart(6, '0')}`;
}

/**
 * Generates a valid zero-dependency PDF invoice stream.
 */
export async function downloadInvoicePdf(invoiceId) {
  const invoice = await db('invoices').where({ id: invoiceId }).first();
  if (!invoice) throw new Error('Invoice not found');

  const customer = await db('customers').where({ id: invoice.customer_id }).first();
  const sub = await db('subscriptions').where({ id: invoice.subscription_id }).first();
  const plan = await db('subscription_plans').where({ id: sub.plan_id }).first();

  const watermark = invoice.status.toUpperCase(); // PAID, UNPAID, OVERDUE, CANCELLED

  // Build a minimal valid PDF containing the invoice details and watermark
  const stream = `BT\n/F1 12 Tf\n30 750 Td\n(BLDE EDC PLATFORM - INVOICE) Tj\nT*\n(-------------------------------------) Tj\nT*\n(Invoice Number: ${invoice.invoice_number}) Tj\nT*\n(Status: ${invoice.status.toUpperCase()}) Tj\nT*\n(Issue Date: ${invoice.issue_date.toString().split('T')[0]}) Tj\nT*\n(Due Date: ${invoice.due_date.toString().split('T')[0]}) Tj\nT*\n(-------------------------------------) Tj\nT*\n(Customer ID: ${customer.customer_id}) Tj\nT*\n(Name: ${customer.name}) Tj\nT*\n(Organization: ${customer.organization}) Tj\nT*\n(-------------------------------------) Tj\nT*\n(Subscription Plan: ${plan.plan_name}) Tj\nT*\n(License Type: ${plan.license_type}) Tj\nT*\n(Amount Due: ${invoice.currency} ${invoice.amount}) Tj\nT*\n(-------------------------------------) Tj\nT*\n(WATERMARK: [${watermark}]) Tj\nET`;

  const header = `%PDF-1.4\n`;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;

  const pdfBody = `${header}${obj1}${obj2}${obj3}${obj4}${obj5}xref\n0 6\n0000000000 65535 f\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n300\n%%EOF\n`;
  return Buffer.from(pdfBody, 'utf8');
}

/**
 * Exports invoice list as a CSV string.
 */
export function exportCsv(invoices) {
  const header = 'id,invoice_number,customer_id,subscription_id,amount,currency,issue_date,due_date,status,payment_method,notes\n';
  const rows = invoices.map(i => {
    return `${i.id},"${i.invoice_number}",${i.customer_id},${i.subscription_id},${i.amount},"${i.currency}","${i.issue_date.toString().split('T')[0]}","${i.due_date.toString().split('T')[0]}","${i.status}","${i.payment_method || ''}","${(i.notes || '').replace(/"/g, '""')}"`;
  }).join('\n');
  return header + rows;
}

/**
 * Exports invoice list as Excel compatible CSV.
 */
export function exportExcel(invoices) {
  // A CSV is fully openable by Excel and is standard for lightweight data exports
  return exportCsv(invoices);
}
