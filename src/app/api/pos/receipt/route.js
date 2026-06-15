import { query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/api-response';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';
import { formatIndianDateTime } from '@/lib/dateUtils';

export async function POST(req) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'MANAGE_BILLING', 'VIEW_ORDERS', 'MANAGE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await req.json();
    const {
      bill_id,
      customer_id,
      receipt_type = 'thermal', // thermal, email, whatsapp, sms, digital
      email,
      phone,
      format = 'pdf' // pdf, png, text
    } = body;

    if (!bill_id) return errorResponse('bill_id required', 400);

    // Fetch bill details
    const billRes = await query(`
      SELECT sb.*, c.name as customer_name, c.email as cust_email, c.phone as cust_phone,
             s.name as store_name, s.address as store_address, s.phone as store_phone
      FROM sales_bills sb
      LEFT JOIN customers c ON sb.customer_id = c.id
      LEFT JOIN stores s ON sb.store_id = s.id
      WHERE sb.id = $1
    `, [bill_id]);

    const bill = billRes.rows[0];
    if (!bill) return errorResponse('Bill not found', 404);

    const storeCheck = requireStore(auth.user, bill.store_id);
    if (storeCheck.error) return storeCheck.error;

    const itemsRes = await query(`
      SELECT sbi.*, p.name, p.sku FROM sales_bill_items sbi
      JOIN products p ON sbi.product_id = p.id
      WHERE sbi.sales_bill_id = $1
    `, [bill_id]);

    const items = itemsRes.rows || [];

    // Generate receipt HTML
    const receiptHTML = generateReceiptHTML({
      bill,
      items,
      store: {
        name: bill.store_name,
        address: bill.store_address,
        phone: bill.store_phone
      },
      customer: {
        name: bill.customer_name || 'Walk-in Customer',
        email: bill.cust_email,
        phone: bill.cust_phone
      }
    });

    // Send receipt based on type
    if (receipt_type === 'email') {
      // TODO: Integrate with email service (SendGrid, etc.)
      console.log('Email receipt:', email);
    } else if (receipt_type === 'whatsapp') {
      // TODO: Integrate with WhatsApp API
      console.log('WhatsApp receipt:', phone);
    } else if (receipt_type === 'sms') {
      // TODO: Integrate with SMS service
      console.log('SMS receipt:', phone);
    }

    // Store receipt in database
    await query(`
      INSERT INTO receipts (bill_id, receipt_type, content, status)
      VALUES ($1, $2, $3, 'generated')
    `, [bill_id, receipt_type, receiptHTML]);

    return successResponse({
      bill_id,
      receipt_type,
      html: receiptHTML,
      status: 'generated'
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

function generateReceiptHTML({ bill, items, store, customer }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; width: 80mm; margin: 0; padding: 5mm; }
        .header { text-align: center; margin-bottom: 10mm; }
        .header h1 { margin: 0; font-size: 18px; }
        .header p { margin: 2px 0; font-size: 11px; }
        .divider { border-top: 1px dashed #000; margin: 5mm 0; }
        .items { font-size: 11px; margin: 5mm 0; }
        .item-row { display: flex; justify-content: space-between; margin: 2mm 0; }
        .item-name { flex: 1; }
        .item-price { text-align: right; min-width: 15mm; }
        .totals { margin-top: 5mm; }
        .total-row { display: flex; justify-content: space-between; font-weight: bold; }
        .footer { text-align: center; margin-top: 5mm; font-size: 10px; }
        table { width: 100%; font-size: 11px; }
        table td { padding: 2px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${store.name || 'RECEIPT'}</h1>
        <p>${store.address}</p>
        <p>Phone: ${store.phone}</p>
      </div>
      
      <div class="divider"></div>
      
      <div style="font-size: 10px; margin-bottom: 5mm;">
        <p><strong>Bill No:</strong> ${bill.invoice_number || 'N/A'}</p>
        <p><strong>Date:</strong> ${formatIndianDateTime(bill.created_at, '-')}</p>
        <p><strong>Customer:</strong> ${customer.name}</p>
      </div>
      
      <div class="divider"></div>
      
      <table>
        <thead>
          <tr style="border-bottom: 1px solid #000;">
            <td><strong>Item</strong></td>
            <td style="text-align: center;"><strong>Qty</strong></td>
            <td style="text-align: right;"><strong>Price</strong></td>
            <td style="text-align: right;"><strong>Total</strong></td>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${item.name} (${item.sku})</td>
              <td style="text-align: center;">${item.qty}</td>
              <td style="text-align: right;">₹${parseFloat(item.selling_price).toFixed(2)}</td>
              <td style="text-align: right;">₹${(item.qty * item.selling_price).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="divider"></div>
      
      <div class="totals">
        <div class="total-row">
          <span>Subtotal</span>
          <span>₹${(bill.total_amount - bill.total_tax - bill.round_off).toFixed(2)}</span>
        </div>
        <div class="total-row" style="font-weight: normal;">
          <span>Tax (GST)</span>
          <span>₹${parseFloat(bill.total_tax).toFixed(2)}</span>
        </div>
        ${bill.discount_amount ? `
          <div class="total-row" style="font-weight: normal;">
            <span>Discount</span>
            <span>-₹${parseFloat(bill.discount_amount).toFixed(2)}</span>
          </div>
        ` : ''}
        ${bill.round_off ? `
          <div class="total-row" style="font-weight: normal;">
            <span>Round Off</span>
            <span>₹${parseFloat(bill.round_off).toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="total-row" style="font-size: 14px; margin-top: 3mm;">
          <span>TOTAL</span>
          <span>₹${parseFloat(bill.total_amount).toFixed(2)}</span>
        </div>
      </div>
      
      <div style="margin-top: 5mm; font-size: 10px;">
        <p><strong>Payment Mode:</strong> ${bill.payment_mode}</p>
      </div>
      
      <div class="divider"></div>
      
      <div class="footer">
        <p>Thank you for your business!</p>
        <p>Please visit us again</p>
      </div>
    </body>
    </html>
  `;
}
