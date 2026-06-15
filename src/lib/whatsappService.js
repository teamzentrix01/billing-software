/**
 * whatsappService.js
 *
 * Sends a formatted WhatsApp bill receipt to the customer's mobile number
 * using the Twilio WhatsApp API.
 *
 * ── Provider ────────────────────────────────────────────────────────────────
 * Default: Twilio (npm install twilio)
 * Alternatives: Meta Cloud API, Wati, Interakt, AiSensy — all use the same
 *   WhatsApp Business API under the hood; only the sendViaProvider() call
 *   changes.
 *
 * ── Configuration (.env) ────────────────────────────────────────────────────
 *   WHATSAPP_ENABLED=true
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   TWILIO_AUTH_TOKEN=your_auth_token
 *   TWILIO_WHATSAPP_FROM=+14155238886   ← sandbox; replace with your number
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   import { sendBillOnWhatsApp } from '@/lib/whatsappService';
 *
 *   // Fire and forget — never await in a request handler
 *   sendBillOnWhatsApp({ customerMobile, storeName, billNumber, ... })
 *     .then(r => updateWhatsappStatus(billId, r.to))
 *     .catch(err => console.warn('[WhatsApp]', err.message));
 */

import twilio from 'twilio';
import { formatIndianDateTime } from '@/lib/dateUtils';

// ─── Lazy Twilio client ────────────────────────────────────────────────────
let _client = null;

function getClient() {
  if (!_client) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error(
        'WhatsApp not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env'
      );
    }
    _client = twilio(sid, token);
  }
  return _client;
}

// ─── Phone normaliser (India-first) ───────────────────────────────────────
// Returns E.164 format (+91XXXXXXXXXX) or null for unrecognisable input.
export function normalizePhone(raw) {
  if (!raw) return null;

  // Strip everything except digits and a leading +
  const cleaned = String(raw).trim();
  const digits  = cleaned.replace(/\D/g, '');

  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;              // Indian 10-digit
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;               // 91XXXXXXXXXX
  }
  if (cleaned.startsWith('+') && digits.length >= 10) {
    return `+${digits}`;               // Already has country code
  }
  if (digits.length > 10) {
    return `+${digits}`;               // Assume full international
  }

  return null; // Unrecognisable — don't attempt send
}

// ─── Message formatter ─────────────────────────────────────────────────────
export function formatBillMessage({
  billNumber,
  storeName,
  customerName,
  items = [],
  subtotal      = 0,
  discountTotal = 0,
  taxTotal      = 0,
  grandTotal    = 0,
  paymentMode   = 'Cash',
  createdAt,
  publicToken   = null,   // ← added for digital invoice link
}) {
  const date = formatIndianDateTime(createdAt || Date.now(), '-');

  const firstName =
    customerName && customerName !== 'Walk-in Customer'
      ? customerName.split(' ')[0]
      : null;

  const greeting = firstName
    ? `Hi *${firstName}*! Here is your bill.`
    : `Hello! Here is your bill.`;

  // Build item lines
  const itemLines = items
    .map((item) => {
      const name  = item.productName || item.product_name || item.name || 'Item';
      const qty   = Number(item.qty);
      const total = Number(
        item.lineTotal ?? item.line_total ?? qty * (item.sellingPrice ?? item.selling_price ?? 0)
      ).toFixed(2);
      return `  • ${name} × ${qty} = ₹${total}`;
    })
    .join('\n');

  // Build summary line
  const sub  = Number(subtotal).toFixed(2);
  const disc = Number(discountTotal);
  const tax  = Number(taxTotal);
  const tot  = Number(grandTotal).toFixed(2);

  let summaryLines = `Subtotal:    ₹${sub}`;
  if (disc > 0) summaryLines += `\nDiscount:  -₹${disc.toFixed(2)}`;
  if (tax  > 0) summaryLines += `\nTax:        ₹${tax.toFixed(2)}`;
  summaryLines += `\n*Total:     ₹${tot}*`;
  summaryLines += `\nPaid via:   ${paymentMode}`;

  // Digital invoice link (if public_token is available)
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const invoiceLink = publicToken ? `${appUrl}/invoice/${publicToken}` : null;
  const invoiceSection = invoiceLink
    ? `\n📄 *View Digital Invoice*\n${invoiceLink}\n_(Tap to view, download or print)_\n`
    : '';

  return (
    `🧾 *Receipt — ${storeName}*\n\n` +
    `${greeting}\n\n` +
    `Bill No: *${billNumber}*\n` +
    `Date:    ${date}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `*Items Purchased*\n${itemLines}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${summaryLines}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${invoiceSection}\n` +
    `*Thank you for shopping at ${storeName}!* 🙏\n\n` +
    `_This is your digital receipt._\n` +
    `_Powered by Buyzaar Sync_`
  );
}

// ─── Main export ───────────────────────────────────────────────────────────
/**
 * Send a bill receipt over WhatsApp.
 *
 * @param {object}   params
 * @param {string}   params.customerMobile   Raw customer mobile (any Indian format)
 * @param {string}   params.storeName        Store display name
 * @param {string}   params.billNumber       Invoice / bill number
 * @param {string}   [params.customerName]   Customer name (optional)
 * @param {object[]} params.items            Line items
 * @param {number}   params.subtotal
 * @param {number}   [params.discountTotal]
 * @param {number}   [params.taxTotal]
 * @param {number}   params.grandTotal
 * @param {string}   params.paymentMode
 * @param {string|Date} [params.createdAt]
 *
 * @returns {Promise<{ sid: string, status: string, to: string }>}
 * @throws  {Error} if WHATSAPP_ENABLED=false, phone invalid, or Twilio fails
 */
export async function sendBillOnWhatsApp(params) {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    throw new Error('WhatsApp sending is disabled (WHATSAPP_ENABLED != true)');
  }

  const fromEnv = process.env.TWILIO_WHATSAPP_FROM;
  if (!fromEnv) {
    throw new Error('TWILIO_WHATSAPP_FROM not set in .env');
  }

  const toNumber = normalizePhone(params.customerMobile);
  if (!toNumber) {
    throw new Error(`Cannot normalise phone number: "${params.customerMobile}"`);
  }

  const body = formatBillMessage(params);
  const msg  = await getClient().messages.create({
    from: `whatsapp:${fromEnv}`,
    to:   `whatsapp:${toNumber}`,
    body,
  });

  return { sid: msg.sid, status: msg.status, to: toNumber };
}
