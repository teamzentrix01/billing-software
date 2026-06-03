import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureUserCounterSessionSchema } from '@/lib/userCounterSessionSchema';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureStoreCashBalance, ensureStoreCashSchema } from '@/lib/storeCashSchema';
import { extractAuthUser, requirePermission, requireStore } from '@/lib/api-protection';

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeSessionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    counterId: row.counter_id,
    deviceId: row.device_id,
    deviceUid: row.device_uid || '',
    counterUid: row.counter_uid || '',
    storeId: row.store_id,
    sessionId: row.session_id,
    sessionStartAt: row.session_start_at,
    sessionEndAt: row.session_end_at,
    isActive: row.is_active,
    serialNumber: row.serial_number || '',
    storeName: row.store_name || '',
    counterName: row.counter_name || '',
    userName: row.user_name || '',
    openingCash: Number(row.opening_cash || 0),
    grossSales: Number(row.gross_sales || row.payment_breakup?.grossSales || 0),
    cashSales: Number(row.cash_sales || row.payment_breakup?.cashSales || 0),
    cardSales: Number(row.card_sales || row.payment_breakup?.cardSales || 0),
    upiSales: Number(row.upi_sales || row.payment_breakup?.upiSales || 0),
    paidTotal: Number(row.paid_total || row.payment_breakup?.paidTotal || 0),
    expectedCash: Number(row.expected_cash || 0),
    actualCash: Number(row.actual_cash || 0),
    countedCash: Number(row.counted_cash || row.actual_cash || 0),
    handoverAmount: Number(row.handover_amount || row.actual_cash || 0),
    managerReceivedAmount: Number(row.manager_received_amount || 0),
    variance: Number(row.variance || 0),
    handoverStatus: row.handover_status || (row.closed_at ? 'pending_handover' : 'active'),
    closedAt: row.closed_at || null,
    closingRemarks: row.closing_remarks || '',
    meta: row.meta || {},
  };
}

function hasAnyPermission(user, permissions = []) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  return userPermissions.includes('*') || permissions.some((permission) => userPermissions.includes(permission));
}

export async function GET(request) {
  try {
    await ensureUserCounterSessionSchema();
    await ensureSalesBillingSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }
    const permissionCheck = requirePermission(auth.user, 'OPEN_CLOSE_SESSION', 'MANAGE_POS', 'VIEW_REPORTS', 'VIEW_STORE_REPORTS', 'MANAGE_USERS');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const dateFrom = parseDate(url.searchParams.get('dateFrom'));
    const dateTo = parseDate(url.searchParams.get('dateTo'));
    const storeId = Number(url.searchParams.get('storeId') || url.searchParams.get('store_id') || 0);

    const whereClauses = [];
    const params = [];

    if (dateFrom) {
      params.push(dateFrom);
      whereClauses.push(`ucs.session_start_at >= $${params.length}::date`);
    }

    if (dateTo) {
      params.push(dateTo);
      whereClauses.push(`ucs.session_start_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    if (Number.isFinite(storeId) && storeId > 0) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) return storeCheck.error;
      params.push(storeId);
      whereClauses.push(`ucs.store_id = $${params.length}`);
    }

    const user = auth.user;
    if (user && user.role !== 'super_admin') {
      const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
      if (assignedStores.length === 0) {
        return NextResponse.json([]);
      }
      params.push(assignedStores);
      whereClauses.push(`ucs.store_id = ANY($${params.length}::int[])`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await query(
      `SELECT ucs.id,
              ucs.user_id,
              ucs.counter_id,
              ucs.device_id,
              ucs.device_uid,
              ucs.counter_uid,
              ucs.store_id,
              ucs.session_id,
              ucs.session_start_at,
              ucs.session_end_at,
              ucs.is_active,
              ucs.serial_number,
              ucs.counter_name,
              ucs.meta,
              cc.opening_cash,
              cc.expected_cash,
              cc.actual_cash,
              cc.counted_cash,
              cc.handover_amount,
              cc.manager_received_amount,
              cc.variance,
              cc.handover_status,
              cc.payment_breakup,
              cc.closed_at,
              cc.remarks AS closing_remarks,
              COALESCE((cc.payment_breakup->>'grossSales')::numeric, live.gross_sales, 0) AS gross_sales,
              COALESCE((cc.payment_breakup->>'cashSales')::numeric, live.cash_sales, 0) AS cash_sales,
              COALESCE((cc.payment_breakup->>'cardSales')::numeric, live.card_sales, 0) AS card_sales,
              COALESCE((cc.payment_breakup->>'upiSales')::numeric, live.upi_sales, 0) AS upi_sales,
              COALESCE((cc.payment_breakup->>'paidTotal')::numeric, live.paid_total, 0) AS paid_total,
              u.name AS user_name,
              s.name AS store_name
       FROM user_counter_sessions ucs
       LEFT JOIN users u ON u.id = ucs.user_id
       LEFT JOIN stores s ON s.id = ucs.store_id
       LEFT JOIN cashier_closings cc ON cc.session_id = ucs.session_id
       LEFT JOIN (
         SELECT
           live_bills.session_id,
           live_bills.gross_sales,
           COALESCE(live_payments.cash_sales, 0) AS cash_sales,
           COALESCE(live_payments.card_sales, 0) AS card_sales,
           COALESCE(live_payments.upi_sales, 0) AS upi_sales,
           COALESCE(live_payments.paid_total, 0) AS paid_total
         FROM (
           SELECT session_id, COALESCE(SUM(grand_total), 0) AS gross_sales
           FROM sales_bills
           WHERE status IN ('paid', 'completed')
           GROUP BY session_id
         ) live_bills
         LEFT JOIN (
           SELECT
             sb.session_id,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(sbp.method, '')) = 'cash' THEN sbp.amount ELSE 0 END), 0) AS cash_sales,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(sbp.method, '')) = 'card' THEN sbp.amount ELSE 0 END), 0) AS card_sales,
             COALESCE(SUM(CASE WHEN LOWER(COALESCE(sbp.method, '')) = 'upi' THEN sbp.amount ELSE 0 END), 0) AS upi_sales,
             COALESCE(SUM(sbp.amount), 0) AS paid_total
           FROM sales_bills sb
           LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
           WHERE sb.status IN ('paid', 'completed')
           GROUP BY sb.session_id
         ) live_payments ON live_payments.session_id = live_bills.session_id
       ) live ON live.session_id = ucs.session_id
       ${whereSql}
       ORDER BY ucs.session_start_at DESC, ucs.id DESC`,
      params
    );

    return NextResponse.json(res.rows.map(normalizeSessionRow));
  } catch (err) {
    console.error('[employee user counter session GET]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to fetch user counter sessions' }, { status: 500 });
  }
}

export async function POST(request) {
  let client;
  try {
    await ensureUserCounterSessionSchema();
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
    }
    const permissionCheck = requirePermission(auth.user, 'OPEN_CLOSE_SESSION', 'MANAGE_POS', 'CREATE_POS_BILL');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const userId = Number(body.userId || body.user_id);
    const storeId = body.storeId || body.store_id ? Number(body.storeId || body.store_id) : null;
    const counterId = body.counterId || body.counter_id ? Number(body.counterId || body.counter_id) : null;
    const deviceId = body.deviceId || body.device_id ? Number(body.deviceId || body.device_id) : null;
    const serialNumber = String(body.serialNumber || body.serial_number || '').trim();
    const counterName = String(body.counterName || body.counter_name || '').trim();
    const deviceUid = String(body.deviceUid || body.device_uid || '').trim();
    const counterUid = String(body.counterUid || body.counter_uid || counterName || '').trim();

    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: 'User id is required' }, { status: 400 });
    }
    if (userId !== Number(auth.user.id) && !hasAnyPermission(auth.user, ['OPEN_CLOSE_SESSION', 'MANAGE_POS', 'MANAGE_USERS'])) {
      return NextResponse.json({ error: 'You can only open your own POS session' }, { status: 403 });
    }

    if (!storeId) return NextResponse.json({ error: 'Store is required' }, { status: 400 });
    const storeCheck = requireStore(auth.user, storeId);
    if (storeCheck.error) return storeCheck.error;

    if (deviceUid || counterUid) {
      const activeSession = await query(
        `SELECT ucs.id, ucs.user_id, ucs.counter_id, ucs.device_id, ucs.store_id,
                ucs.session_id, ucs.session_start_at, ucs.session_end_at, ucs.is_active,
                ucs.serial_number, ucs.counter_name, ucs.device_uid, ucs.counter_uid, ucs.meta,
                s.name AS store_name, u.name AS user_name
         FROM user_counter_sessions ucs
         LEFT JOIN stores s ON s.id = ucs.store_id
         LEFT JOIN users u ON u.id = ucs.user_id
         WHERE ucs.user_id = $1
           AND ucs.store_id = $2
           AND ucs.is_active = TRUE
           AND COALESCE(ucs.device_uid, '') = COALESCE($3, '')
           AND COALESCE(ucs.counter_uid, '') = COALESCE($4, '')
         ORDER BY ucs.session_start_at DESC
         LIMIT 1`,
        [userId, storeId, deviceUid || null, counterUid || null]
      );
      if (activeSession.rows.length > 0) {
        return NextResponse.json(normalizeSessionRow(activeSession.rows[0]), { status: 200 });
      }
    }

    client = await getClient();
    await client.query('BEGIN');
    const openingCash = Math.max(0, Number(body.openingCash || body.opening_cash || 0));
    const storeBalance = await ensureStoreCashBalance(client, storeId);
    if (openingCash > storeBalance.currentCash) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `Only ${storeBalance.currentCash} cash is available for opening float` }, { status: 400 });
    }

    const sessionId = `SESSION-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const meta = {
      opening_cash: openingCash,
      source: 'pos',
      opening_cash_source: openingCash > 0 ? 'manual' : 'employee_session',
      opened_at: new Date().toISOString(),
      device_uid: deviceUid || null,
      counter_uid: counterUid || null,
      ...(body.meta || {}),
    };

    if (openingCash > 0) {
      const nextStoreCash = Number((storeBalance.currentCash - openingCash).toFixed(2));
      await client.query(
        `UPDATE store_cash_balances
         SET current_cash = $1,
             updated_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
         WHERE store_id = $3`,
        [
          nextStoreCash,
          JSON.stringify({ source: 'opening_float', sessionId, openingCash }),
          storeId,
        ]
      );
      await client.query(
        `INSERT INTO store_cash_transactions (
           store_id, transaction_type, direction, amount, balance_after,
           transaction_date, reference_type, reference_id, remarks, created_by, meta
         ) VALUES ($1, 'opening_float', 'out', $2, $3, CURRENT_DATE, 'user_counter_session', $4, $5, $6, $7::jsonb)`,
        [
          storeId,
          openingCash,
          nextStoreCash,
          sessionId,
          `Opening float assigned to ${counterName || 'POS Counter'}`,
          auth.user.id,
          JSON.stringify({ sessionId, userId, counterName }),
        ]
      );
    }

    const result = await client.query(
      `INSERT INTO user_counter_sessions (
        user_id, counter_id, device_id, store_id, session_id,
        session_start_at, is_active, serial_number, counter_name, device_uid, counter_uid, meta
       ) VALUES ($1, $2, $3, $4, $5, NOW(), TRUE, $6, $7, $8, $9, $10::jsonb)
       RETURNING id, user_id, counter_id, device_id, store_id, session_id, session_start_at, session_end_at, is_active, serial_number, counter_name, device_uid, counter_uid, meta`,
      [
        userId,
        counterId,
        deviceId,
        storeId,
        sessionId,
        serialNumber || null,
        counterName || null,
        deviceUid || null,
        counterUid || null,
        JSON.stringify(meta),
      ]
    );

    await client.query('COMMIT');
    return NextResponse.json(normalizeSessionRow(result.rows[0]), { status: 201 });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[employee user counter session POST]', err.message);
    return NextResponse.json({ error: 'Failed to open user counter session' }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
