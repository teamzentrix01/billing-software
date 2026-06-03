import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { appendStoreScope, requireAuth, requirePermission } from '@/lib/api-protection';
import { ensureProcurementSchema } from '@/lib/procurementSchema';
import { ensurePurchaseOrderSchema } from '@/lib/purchaseOrderSchema';
import { ensureStockInSchema } from '@/lib/stockInSchema';
import { ensureVendorInvoicesSchema } from '@/lib/vendorInvoicesSchema';
import { ensureMarginApprovalSchema } from '@/lib/marginApprovalSchema';

function mapAlert(row) {
  const rawStatus = String(row.status || '').trim().toLowerCase();
  const displayStatus = (() => {
    if (row.kind === 'grn' && rawStatus === 'draft') return 'Pending confirmation';
    if (row.kind === 'purchase_order' && rawStatus === 'draft') return 'Pending';
    if (rawStatus === 'submitted') return 'Submitted';
    if (rawStatus === 'partial') return 'Partial';
    if (rawStatus === 'pending') return 'Pending';
    if (rawStatus === 'confirmed') return 'Confirmed';
    if (!rawStatus) return 'Pending';
    return rawStatus
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  })();

  return {
    id: `${row.kind}-${row.id}`,
    kind: row.kind,
    recordId: row.id,
    transactionId: row.transaction_id || '',
    title: row.title || '',
    storeId: row.store_id,
    storeName: row.store_name || '',
    vendorName: row.vendor_name || '',
    amount: Number(row.amount || 0),
    status: row.status || '',
    displayStatus,
    createdAt: row.created_at,
    href: row.href || '/purchase',
  };
}

export async function GET(request) {
  try {
    await Promise.all([
      ensureProcurementSchema(),
      ensurePurchaseOrderSchema(),
      ensureStockInSchema(),
      ensureVendorInvoicesSchema(),
      ensureMarginApprovalSchema(),
    ]);
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS', 'MANAGE_INVENTORY');
    if (permissionCheck.error) return permissionCheck.error;

    const quotationWhere = [`LOWER(COALESCE(vq.status, 'draft')) IN ('draft', 'submitted')`];
    const returnWhere = [`LOWER(COALESCE(pr.status, 'draft')) IN ('draft', 'submitted')`];
    const poWhere = [`LOWER(COALESCE(po.status, 'draft')) = 'draft'`];
    const grnWhere = [`LOWER(COALESCE(si.status, 'draft')) = 'draft'`, `COALESCE(si.reference_type, '') = 'purchase_order'`];
    const invoiceWhere = [`LOWER(COALESCE(vi.status, 'pending')) IN ('pending', 'partial')`];
    const marginWhere = [`LOWER(COALESCE(mar.status, 'pending')) = 'pending'`];
    const params = [];

    const qScope = appendStoreScope(quotationWhere, params, 'vq.store_id', auth.user);
    if (qScope.error) return qScope.error;
    const rScope = appendStoreScope(returnWhere, params, 'pr.store_id', auth.user);
    if (rScope.error) return rScope.error;
    const poScope = appendStoreScope(poWhere, params, 'po.destination_id', auth.user);
    if (poScope.error) return poScope.error;
    const grnScope = appendStoreScope(grnWhere, params, 'si.destination_id', auth.user);
    if (grnScope.error) return grnScope.error;
    const invoiceScope = appendStoreScope(invoiceWhere, params, 'COALESCE(po_i.destination_id, si_i.destination_id)', auth.user);
    if (invoiceScope.error) return invoiceScope.error;
    const marginScope = appendStoreScope(marginWhere, params, 'mar.store_id', auth.user);
    if (marginScope.error) return marginScope.error;

    const res = await query(
      `SELECT * FROM (
         SELECT 'quotation' AS kind, vq.id, vq.transaction_id, 'Vendor quotation pending' AS title,
                vq.store_id, s.name AS store_name, v.name AS vendor_name,
                0::numeric AS amount, vq.status, vq.created_at, '/purchase/quotations' AS href
         FROM vendor_quotations vq
         LEFT JOIN stores s ON s.id = vq.store_id
         LEFT JOIN vendors v ON v.id = vq.vendor_id
         WHERE ${quotationWhere.join(' AND ')}

         UNION ALL
         SELECT 'purchase_return' AS kind, pr.id, pr.transaction_id, 'Purchase return pending' AS title,
                pr.store_id, s.name AS store_name, v.name AS vendor_name,
                pr.total_amount AS amount, pr.status, pr.created_at, '/purchase/returns' AS href
         FROM purchase_returns pr
         LEFT JOIN stores s ON s.id = pr.store_id
         LEFT JOIN vendors v ON v.id = pr.vendor_id
         WHERE ${returnWhere.join(' AND ')}

         UNION ALL
         SELECT 'purchase_order' AS kind, po.id, po.transaction_id, 'Purchase order draft' AS title,
                po.destination_id AS store_id, s.name AS store_name, v.name AS vendor_name,
                po.total_cost AS amount, po.status, po.created_at, '/purchase/purchase-orders' AS href
         FROM purchase_orders po
         LEFT JOIN stores s ON s.id = po.destination_id
         LEFT JOIN vendors v ON v.id = po.vendor_id
         WHERE ${poWhere.join(' AND ')}

         UNION ALL
         SELECT 'grn' AS kind, si.id, si.transaction_id, 'GRN pending confirmation' AS title,
                si.destination_id AS store_id, s.name AS store_name, COALESCE(v.name, si.vendor_name) AS vendor_name,
                si.total_cost AS amount, si.status, si.created_at, '/purchase/grn' AS href
         FROM stock_in si
         LEFT JOIN stores s ON s.id = si.destination_id
         LEFT JOIN vendors v ON v.id = si.vendor_id
         WHERE ${grnWhere.join(' AND ')}

         UNION ALL
         SELECT 'vendor_invoice' AS kind, vi.id, vi.transaction_id, 'Vendor invoice due' AS title,
                COALESCE(po_i.destination_id, si_i.destination_id) AS store_id,
                s.name AS store_name, v.name AS vendor_name,
                GREATEST(COALESCE(vi.total_amount, 0) - COALESCE(vi.amount_paid, 0), 0) AS amount,
                vi.status, vi.created_at, '/purchase/vendor-invoices' AS href
         FROM vendor_invoices vi
         LEFT JOIN purchase_orders po_i ON po_i.id = vi.purchase_order_id
         LEFT JOIN stock_in si_i ON si_i.id = vi.stock_in_id
         LEFT JOIN stores s ON s.id = COALESCE(po_i.destination_id, si_i.destination_id)
         LEFT JOIN vendors v ON v.id = vi.vendor_id
         WHERE ${invoiceWhere.join(' AND ')}

         UNION ALL
         SELECT 'margin_approval' AS kind, mar.id, mar.source_reference AS transaction_id, 'Margin approval pending' AS title,
                mar.store_id, s.name AS store_name, p.name AS vendor_name,
                0::numeric AS amount, mar.status, mar.created_at, '/purchase/margin-approvals' AS href
         FROM margin_approval_requests mar
         LEFT JOIN stores s ON s.id = mar.store_id
         LEFT JOIN products p ON p.id = mar.product_id
         WHERE ${marginWhere.join(' AND ')}
       ) alerts
       ORDER BY created_at DESC
       LIMIT 25`,
      params
    );

    return NextResponse.json({ alerts: res.rows.map(mapAlert) });
  } catch (err) {
    console.error('[notifications/procurement GET]', err.message);
    return NextResponse.json({ alerts: [] }, { status: 200 });
  }
}
