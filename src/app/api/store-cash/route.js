import { getClient, query } from '@/lib/db';
import { errorResponse, successResponse, validationError } from '@/lib/api-response';
import { ensureStoreCashBalance, ensureStoreCashSchema, getStoreCashBalanceSnapshot } from '@/lib/storeCashSchema';
import { extractAuthUser, requirePermission, requireStore } from '@/lib/api-protection';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function canManageStoreCash(user) {
  if (user?.role === 'super_admin' || user?.role === 'admin') return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes('*') ||
    permissions.includes('MANAGE_POS') ||
    permissions.includes('MANAGE_BILLING') ||
    permissions.includes('OPEN_CLOSE_SESSION');
}

async function resolveUserStore(user) {
  const activeSession = await query(
    `SELECT ucs.store_id, s.name AS store_name
     FROM user_counter_sessions ucs
     LEFT JOIN stores s ON s.id = ucs.store_id
     WHERE ucs.user_id = $1
       AND ucs.is_active = TRUE
     ORDER BY ucs.session_start_at DESC, ucs.id DESC
     LIMIT 1`,
    [user.id]
  );
  if (activeSession.rows[0]?.store_id) {
    return {
      storeId: Number(activeSession.rows[0].store_id),
      storeName: activeSession.rows[0].store_name || '',
    };
  }

  const assignedStores = (user.assigned_stores || []).map(Number).filter(Number.isFinite);
  if (assignedStores.length === 1) {
    const storeRes = await query('SELECT id, name FROM stores WHERE id = $1 LIMIT 1', [assignedStores[0]]);
    return {
      storeId: assignedStores[0],
      storeName: storeRes.rows[0]?.name || `Store ${assignedStores[0]}`,
    };
  }

  if (user.role === 'super_admin') {
    const storeRes = await query('SELECT id, name FROM stores ORDER BY id ASC LIMIT 1');
    if (storeRes.rows[0]) {
      return {
        storeId: Number(storeRes.rows[0].id),
        storeName: storeRes.rows[0].name || `Store ${storeRes.rows[0].id}`,
      };
    }
  }

  return {
    error: 'Open a POS session for your store before using cash tracking.',
  };
}

async function loadSummary(storeId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await ensureStoreCashBalance(client, storeId);
    await client.query('COMMIT');

    const totalsRes = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN sb.created_at >= CURRENT_DATE THEN sbp.amount ELSE 0 END), 0) AS today_cash_sales,
         COALESCE(SUM(CASE WHEN sb.created_at >= DATE_TRUNC('week', CURRENT_DATE) THEN sbp.amount ELSE 0 END), 0) AS week_cash_sales,
         COALESCE(SUM(CASE WHEN sb.created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN sbp.amount ELSE 0 END), 0) AS month_cash_sales
       FROM sales_bills sb
       INNER JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
       WHERE sb.store_id = $1
         AND sb.status IN ('paid', 'completed')
         AND LOWER(COALESCE(sbp.method, '')) = 'cash'`,
      [storeId]
    );

    const withdrawalRes = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_date >= DATE_TRUNC('month', CURRENT_DATE)::date THEN amount ELSE 0 END), 0) AS month_withdrawals,
         MAX(transaction_date) AS last_withdrawal_date
       FROM store_cash_transactions
       WHERE store_id = $1
         AND transaction_type = 'withdrawal'`,
      [storeId]
    );

    const lastWithdrawalRes = await query(
      `SELECT amount, transaction_date, remarks
       FROM store_cash_transactions
       WHERE store_id = $1
         AND transaction_type = 'withdrawal'
       ORDER BY transaction_date DESC, id DESC
       LIMIT 1`,
      [storeId]
    );

    const totals = totalsRes.rows[0] || {};
    const withdrawal = withdrawalRes.rows[0] || {};
    const balance = await getStoreCashBalanceSnapshot(storeId);
    return {
      currentCash: balance.currentCash,
      finalCash: balance.finalCash,
      activeSessionCash: balance.activeSessionCash,
      pendingHandoverCash: balance.pendingHandoverCash,
      todayCashSales: toNumber(totals.today_cash_sales),
      weekCashSales: toNumber(totals.week_cash_sales),
      monthCashSales: toNumber(totals.month_cash_sales),
      monthWithdrawals: toNumber(withdrawal.month_withdrawals),
      lastWithdrawal: lastWithdrawalRes.rows[0] || null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function loadActiveSessions(storeId, currentUserId) {
  const sessionRes = await query(
    `SELECT
       ucs.id,
       ucs.session_id,
       ucs.user_id,
       ucs.store_id,
       ucs.counter_name,
       ucs.session_start_at,
       ucs.meta,
       u.name AS user_name,
       COALESCE(SUM(CASE WHEN LOWER(COALESCE(sbp.method, '')) = 'cash' THEN sbp.amount ELSE 0 END), 0) AS cash_sales,
       COALESCE(SUM(sbp.amount), 0) AS paid_total,
       COUNT(DISTINCT sb.id) AS bill_count
     FROM user_counter_sessions ucs
     LEFT JOIN users u ON u.id = ucs.user_id
     LEFT JOIN sales_bills sb
       ON sb.session_id = ucs.session_id
      AND sb.status IN ('paid', 'completed')
     LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
     WHERE ucs.store_id = $1
       AND ucs.is_active = TRUE
     GROUP BY ucs.id, ucs.session_id, ucs.user_id, ucs.store_id, ucs.counter_name,
              ucs.session_start_at, ucs.meta, u.name
     ORDER BY ucs.session_start_at DESC, ucs.id DESC`,
    [storeId]
  );

  const sessions = sessionRes.rows.map((row) => {
    const openingCash = toNumber(row.meta?.opening_cash);
    const cashSales = toNumber(row.cash_sales);
    return {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      userName: row.user_name || '',
      counterName: row.counter_name || '',
      startedAt: row.session_start_at,
      openingCash,
      cashSales,
      expectedCash: Number((openingCash + cashSales).toFixed(2)),
      paidTotal: toNumber(row.paid_total),
      billCount: toNumber(row.bill_count),
      isCurrentUser: Number(row.user_id) === Number(currentUserId),
    };
  });

  return {
    sessions,
    currentEmployee: sessions.find((session) => session.isCurrentUser) || null,
  };
}

async function loadPendingHandovers(storeId) {
  const handoverRes = await query(
    `SELECT
       cc.id,
       cc.session_id,
       cc.user_id,
       cc.store_id,
       cc.opening_cash,
       cc.expected_cash,
       cc.actual_cash,
       cc.counted_cash,
       cc.handover_amount,
       cc.manager_received_amount,
       cc.variance,
       cc.handover_status,
       cc.closed_at,
       cc.handed_over_at,
       cc.verified_at,
       cc.remarks,
       cc.denominations,
       u.name AS user_name,
       ucs.counter_name
     FROM cashier_closings cc
     LEFT JOIN users u ON u.id = cc.user_id
     LEFT JOIN user_counter_sessions ucs ON ucs.session_id = cc.session_id
     WHERE cc.store_id = $1
       AND COALESCE(cc.handover_status, 'pending_handover') IN ('pending_handover', 'handed_over', 'variance_flagged')
     ORDER BY cc.closed_at DESC, cc.id DESC`,
    [storeId]
  );

  return handoverRes.rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    userName: row.user_name || '',
    counterName: row.counter_name || '',
    openingCash: toNumber(row.opening_cash),
    expectedCash: toNumber(row.expected_cash),
    actualCash: toNumber(row.actual_cash),
    countedCash: toNumber(row.counted_cash || row.actual_cash),
    handoverAmount: toNumber(row.handover_amount || row.actual_cash),
    managerReceivedAmount: toNumber(row.manager_received_amount),
    variance: toNumber(row.variance),
    handoverStatus: row.handover_status || 'pending_handover',
    closedAt: row.closed_at,
    handedOverAt: row.handed_over_at,
    verifiedAt: row.verified_at,
    remarks: row.remarks || '',
    denominations: row.denominations || {},
  }));
}

async function loadLedger(storeId) {
  const ledgerRes = await query(
    `WITH cash_sales AS (
       SELECT
         sb.created_at::date AS transaction_date,
         'cash_sale' AS transaction_type,
         'in' AS direction,
         COALESCE(SUM(sbp.amount), 0) AS amount,
         NULL::numeric AS balance_after,
         'POS cash sales' AS remarks,
         'sales_bills' AS reference_type,
         NULL::text AS reference_id,
         MAX(sb.created_at) AS sort_at
       FROM sales_bills sb
       INNER JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
       WHERE sb.store_id = $1
         AND sb.status IN ('paid', 'completed')
         AND LOWER(COALESCE(sbp.method, '')) = 'cash'
       GROUP BY sb.created_at::date
     ),
     cash_transactions AS (
       SELECT
         transaction_date,
         transaction_type,
         direction,
         amount,
         balance_after,
         remarks,
         reference_type,
         reference_id,
         created_at AS sort_at
       FROM store_cash_transactions
       WHERE store_id = $1
     )
     SELECT *
     FROM (
       SELECT * FROM cash_sales
       UNION ALL
       SELECT * FROM cash_transactions
     ) ledger
     ORDER BY sort_at DESC
     LIMIT 120`,
    [storeId]
  );

  return ledgerRes.rows.map((row) => ({
    date: row.transaction_date,
    type: row.transaction_type,
    direction: row.direction,
    amount: toNumber(row.amount),
    balanceAfter: row.balance_after == null ? null : toNumber(row.balance_after),
    remarks: row.remarks || '',
    referenceType: row.reference_type || '',
    referenceId: row.reference_id || '',
  }));
}

export async function GET(request) {
  try {
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);

    const permissionCheck = requirePermission(auth.user, 'CREATE_POS_BILL', 'OPEN_CLOSE_SESSION', 'MANAGE_POS', 'MANAGE_BILLING', 'VIEW_REPORTS', 'VIEW_STORE_REPORTS');
    if (permissionCheck.error) return permissionCheck.error;

    const resolved = await resolveUserStore(auth.user);
    if (resolved.error) return errorResponse(resolved.error, 400);
    const storeCheck = requireStore(auth.user, resolved.storeId);
    if (storeCheck.error) return storeCheck.error;

    const [summary, activeSessions, pendingHandovers, ledger] = await Promise.all([
      loadSummary(resolved.storeId),
      loadActiveSessions(resolved.storeId, auth.user.id),
      loadPendingHandovers(resolved.storeId),
      loadLedger(resolved.storeId),
    ]);

    return successResponse({
      store: {
        id: resolved.storeId,
        name: resolved.storeName,
      },
      summary,
      activeSessions,
      pendingHandovers,
      ledger,
    });
  } catch (err) {
    console.error('[store-cash GET]', err.message);
    return errorResponse(err.message || 'Failed to load store cash');
  }
}

export async function PATCH(request) {
  let client;
  try {
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);
    if (!canManageStoreCash(auth.user)) return errorResponse('You do not have permission to verify cash handovers', 403);

    const body = await request.json();
    const closingId = Number(body.closingId || body.closing_id);
    const remarks = String(body.remarks || '').trim();
    const receivedAmountInput = body.receivedAmount ?? body.received_amount ?? body.managerReceivedAmount ?? body.manager_received_amount;

    if (!Number.isFinite(closingId) || closingId <= 0) {
      return validationError({ closingId: 'Closing id is required' });
    }

    client = await getClient();
    await client.query('BEGIN');

    const closingRes = await client.query(
      `SELECT *
       FROM cashier_closings
       WHERE id = $1
       FOR UPDATE`,
      [closingId]
    );
    const closing = closingRes.rows[0];
    if (!closing) {
      await client.query('ROLLBACK');
      return errorResponse('Cash handover not found', 404);
    }

    const storeCheck = requireStore(auth.user, closing.store_id);
    if (storeCheck.error) {
      await client.query('ROLLBACK');
      return storeCheck.error;
    }

    if (closing.handover_status === 'manager_verified') {
      await client.query('ROLLBACK');
      return errorResponse('Cash handover is already verified', 409);
    }

    const defaultReceived = toNumber(closing.handover_amount || closing.actual_cash);
    const receivedAmount = Math.max(0, toNumber(receivedAmountInput, defaultReceived));
    const storeBalance = await ensureStoreCashBalance(client, closing.store_id);
    const nextBalance = Number((storeBalance.currentCash + receivedAmount).toFixed(2));
    const handoverVariance = Number((receivedAmount - defaultReceived).toFixed(2));
    const nextStatus = Math.abs(handoverVariance) > 0.01 ? 'variance_flagged' : 'manager_verified';

    await client.query(
      `UPDATE cashier_closings
       SET manager_received_amount = $1,
           handover_status = $2,
           verified_by = $3,
           verified_at = NOW(),
           remarks = COALESCE($4, remarks),
           meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb
       WHERE id = $6`,
      [
        receivedAmount,
        nextStatus,
        auth.user.id,
        remarks || null,
        JSON.stringify({ managerVerificationRemarks: remarks, handoverVariance }),
        closingId,
      ]
    );

    if (nextStatus === 'manager_verified') {
      await client.query(
        `UPDATE store_cash_balances
         SET current_cash = $1,
             last_closing_id = $2,
             updated_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb
         WHERE store_id = $4`,
        [
          nextBalance,
          closingId,
          JSON.stringify({ source: 'manager_verified_handover', closingId, receivedAmount }),
          closing.store_id,
        ]
      );

      await client.query(
        `INSERT INTO store_cash_transactions (
           store_id, transaction_type, direction, amount, balance_after,
           transaction_date, reference_type, reference_id, remarks, created_by, meta
         ) VALUES ($1, 'handover_verified', 'in', $2, $3, CURRENT_DATE, 'cashier_closing', $4, $5, $6, $7::jsonb)`,
        [
          closing.store_id,
          receivedAmount,
          nextBalance,
          String(closingId),
          remarks || 'Manager verified session cash handover',
          auth.user.id,
          JSON.stringify({ sessionId: closing.session_id, closingId, receivedAmount }),
        ]
      );
    }

    await client.query('COMMIT');

    return successResponse({
      closingId,
      status: nextStatus,
      receivedAmount,
      balanceAfter: nextStatus === 'manager_verified' ? nextBalance : storeBalance.currentCash,
      handoverVariance,
    }, nextStatus === 'manager_verified' ? 'Cash handover verified' : 'Cash handover variance flagged');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[store-cash PATCH]', err.message);
    return errorResponse(err.message || 'Failed to verify cash handover');
  } finally {
    if (client) client.release();
  }
}

export async function POST(request) {
  let client;
  try {
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);
    if (!canManageStoreCash(auth.user)) return errorResponse('You do not have permission to withdraw store cash', 403);

    const resolved = await resolveUserStore(auth.user);
    if (resolved.error) return errorResponse(resolved.error, 400);
    const storeCheck = requireStore(auth.user, resolved.storeId);
    if (storeCheck.error) return storeCheck.error;

    const body = await request.json();
    const amount = toNumber(body.amount);
    const remarks = String(body.remarks || '').trim();
    const takenBy = String(body.takenBy || body.taken_by || auth.user.name || '').trim();
    const transactionDate = normalizeDate(body.transactionDate || body.transaction_date);

    if (amount <= 0) {
      return validationError({ amount: 'Withdrawal amount must be greater than zero' });
    }

    client = await getClient();
    await client.query('BEGIN');
    const balance = await ensureStoreCashBalance(client, resolved.storeId);
    if (amount > balance.currentCash) {
      await client.query('ROLLBACK');
      return errorResponse(`Only ${balance.currentCash} cash is available in this store`, 400);
    }

    const nextBalance = Number((balance.currentCash - amount).toFixed(2));
    await client.query(
      `UPDATE store_cash_balances
       SET current_cash = $1,
           updated_at = NOW(),
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
       WHERE store_id = $3`,
      [
        nextBalance,
        JSON.stringify({ lastWithdrawalAt: new Date().toISOString(), lastWithdrawalAmount: amount }),
        resolved.storeId,
      ]
    );

    const insertRes = await client.query(
      `INSERT INTO store_cash_transactions (
         store_id, transaction_type, direction, amount, balance_after,
         transaction_date, reference_type, reference_id, remarks, created_by, meta
       ) VALUES ($1, 'withdrawal', 'out', $2, $3, $4::date, 'owner_withdrawal', NULL, $5, $6, $7::jsonb)
       RETURNING id`,
      [
        resolved.storeId,
        amount,
        nextBalance,
        transactionDate,
        remarks || null,
        auth.user.id,
        JSON.stringify({ takenBy }),
      ]
    );

    await client.query('COMMIT');
    return successResponse({
      id: insertRes.rows[0].id,
      store: { id: resolved.storeId, name: resolved.storeName },
      amount,
      balanceAfter: nextBalance,
      transactionDate,
      remarks,
      takenBy,
    }, 'Cash withdrawal recorded', 201);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[store-cash POST]', err.message);
    return errorResponse(err.message || 'Failed to record cash withdrawal');
  } finally {
    if (client) client.release();
  }
}
