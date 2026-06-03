import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import {
  applyApprovedMarginRequest,
  ensureMarginApprovalSchema,
} from '@/lib/marginApprovalSchema';
import { appendStoreScope, auditLog, requireAuth, requirePermission } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canApproveMargin(user) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes('*') || permissions.includes('MANAGE_BILLING') || permissions.includes('MANAGE_CATALOG');
}

function mapRow(row) {
  return {
    id: row.id,
    status: row.status || 'pending',
    sourceType: row.source_type || '',
    sourceReference: row.source_reference || '',
    productId: row.product_id,
    productName: row.product_name || '',
    sku: row.sku || '',
    barcode: row.barcode || '',
    storeId: row.store_id,
    storeName: row.store_name || '',
    requestedByName: row.requested_by_name || '',
    approvedByName: row.approved_by_name || '',
    rejectedByName: row.rejected_by_name || '',
    currentCostPrice: toNumber(row.current_cost_price),
    requestedCostPrice: toNumber(row.requested_cost_price),
    currentMrp: toNumber(row.current_mrp),
    requestedMrp: toNumber(row.requested_mrp),
    currentSellingPrice: toNumber(row.current_selling_price),
    requestedSellingPrice: toNumber(row.requested_selling_price),
    currentMarginPercent: toNumber(row.current_margin_percent),
    requestedMarginPercent: toNumber(row.requested_margin_percent),
    remarks: row.remarks || '',
    rejectionReason: row.rejection_reason || '',
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
  };
}

export async function GET(request) {
  try {
    await ensureMarginApprovalSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_PURCHASE_ORDERS', 'MANAGE_VENDORS', 'MANAGE_BILLING', 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const status = String(searchParams.get('status') || 'pending').trim().toLowerCase();
    const search = String(searchParams.get('search') || '').trim();
    const params = [];
    const where = [];

    if (status && status !== 'all') {
      params.push(status);
      where.push(`LOWER(mar.status) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        mar.id::text ILIKE $${params.length}
        OR mar.status ILIKE $${params.length}
        OR mar.source_type ILIKE $${params.length}
        OR mar.source_reference ILIKE $${params.length}
        OR mar.remarks ILIKE $${params.length}
        OR mar.rejection_reason ILIKE $${params.length}
        OR mar.current_cost_price::text ILIKE $${params.length}
        OR mar.requested_cost_price::text ILIKE $${params.length}
        OR mar.current_mrp::text ILIKE $${params.length}
        OR mar.requested_mrp::text ILIKE $${params.length}
        OR mar.current_selling_price::text ILIKE $${params.length}
        OR mar.requested_selling_price::text ILIKE $${params.length}
        OR mar.current_margin_percent::text ILIKE $${params.length}
        OR mar.requested_margin_percent::text ILIKE $${params.length}
        OR mar.product_id::text ILIKE $${params.length}
        OR mar.store_id::text ILIKE $${params.length}
        OR p.name ILIKE $${params.length}
        OR p.sku ILIKE $${params.length}
        OR p.barcode ILIKE $${params.length}
        OR s.name ILIKE $${params.length}
        OR requested_by.name ILIKE $${params.length}
        OR approved_by.name ILIKE $${params.length}
        OR rejected_by.name ILIKE $${params.length}
      )`);
    }

    const scope = appendStoreScope(where, params, 'mar.store_id', auth.user);
    if (scope.error) return scope.error;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const res = await query(
      `SELECT
         mar.*,
         p.name AS product_name,
         p.sku,
         p.barcode,
         s.name AS store_name,
         requested_by.name AS requested_by_name,
         approved_by.name AS approved_by_name,
         rejected_by.name AS rejected_by_name
       FROM margin_approval_requests mar
       LEFT JOIN products p ON p.id = mar.product_id
       LEFT JOIN stores s ON s.id = mar.store_id
       LEFT JOIN users requested_by ON requested_by.id = mar.requested_by
       LEFT JOIN users approved_by ON approved_by.id = mar.approved_by
       LEFT JOIN users rejected_by ON rejected_by.id = mar.rejected_by
       ${whereSql}
       ORDER BY mar.created_at DESC
       LIMIT 200`,
      params
    );

    return NextResponse.json({
      canApprove: canApproveMargin(auth.user),
      records: res.rows.map(mapRow),
    });
  } catch (err) {
    console.error('[margin-approvals GET]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to load margin approvals' }, { status: 500 });
  }
}

export async function PATCH(request) {
  let client;
  try {
    await ensureMarginApprovalSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    if (!canApproveMargin(auth.user)) {
      return NextResponse.json({ error: 'Only admin can approve margin changes' }, { status: 403 });
    }

    const body = await request.json();
    const id = Number(body.id || body.requestId);
    const action = String(body.action || '').trim().toLowerCase();
    if (!id) return NextResponse.json({ error: 'Request id is required' }, { status: 400 });
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Action must be approve or reject' }, { status: 400 });
    }

    client = await getClient();
    await client.query('BEGIN');

    if (action === 'approve') {
      const applied = await applyApprovedMarginRequest(client, id, auth.user.id);
      await client.query('COMMIT');
      await auditLog(auth.user.id, 'margin_approval.approve', 'margin_approval_requests', id, {
        productId: applied.product_id,
        storeId: applied.store_id,
      });
      return NextResponse.json({ success: true, status: 'approved' });
    }

    const reqRes = await client.query(
      `SELECT id, status, product_id, store_id
       FROM margin_approval_requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    const row = reqRes.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
    }
    if (String(row.status || '').toLowerCase() !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Only pending requests can be rejected' }, { status: 409 });
    }

    await client.query(
      `UPDATE margin_approval_requests
       SET status = 'rejected',
           rejected_by = $2,
           rejected_at = NOW(),
           rejection_reason = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [id, auth.user.id, body.reason || body.rejectionReason || null]
    );

    await client.query('COMMIT');
    await auditLog(auth.user.id, 'margin_approval.reject', 'margin_approval_requests', id, {
      productId: row.product_id,
      storeId: row.store_id,
      reason: body.reason || body.rejectionReason || null,
    });
    return NextResponse.json({ success: true, status: 'rejected' });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[margin-approvals PATCH]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update margin approval' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
