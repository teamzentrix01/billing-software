import { query, getClient } from '@/lib/db';
import { successResponse, errorResponse, validationError, notFoundError } from '@/lib/api-response';
import { ensureSalesBillingSchema } from '@/lib/salesBillingSchema';
import { ensureStoreCashSchema } from '@/lib/storeCashSchema';
import { extractAuthUser, requireStore } from '@/lib/api-protection';

const SESSION_CLOSE_CUTOFF_HOUR = 21;
const SESSION_TIME_ZONE = 'Asia/Kolkata';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCurrentHourInTimeZone(timeZone = SESSION_TIME_ZONE) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
}

function canCloseSessionNow() {
  return getCurrentHourInTimeZone() >= SESSION_CLOSE_CUTOFF_HOUR;
}

function canManageSessions(user) {
  if (user?.role === 'super_admin') return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return permissions.includes('*') ||
    permissions.includes('OPEN_CLOSE_SESSION') ||
    permissions.includes('MANAGE_POS') ||
    permissions.includes('MANAGE_USERS');
}

function mapClosingTotals(row = {}) {
  const openingCash = toNumber(row.opening_cash);
  const cashSales = toNumber(row.cash_sales);
  const cashWithdrawals = toNumber(row.cash_withdrawals);
  const expectedCash = Number((openingCash + cashSales - cashWithdrawals).toFixed(2));

  return {
    openingCash,
    cashSales,
    cashWithdrawals,
    cardSales: toNumber(row.card_sales),
    upiSales: toNumber(row.upi_sales),
    splitSales: toNumber(row.split_sales),
    grossSales: toNumber(row.gross_sales),
    discountTotal: toNumber(row.discount_total),
    taxTotal: toNumber(row.tax_total),
    dueTotal: toNumber(row.due_total),
    paidTotal: toNumber(row.paid_total),
    billCount: toNumber(row.bill_count),
    expectedCash,
  };
}

const SESSION_TOTALS_SQL = `
  WITH session_scope AS (
    SELECT session_id, store_id, session_start_at
    FROM user_counter_sessions
    WHERE session_id = $1
    LIMIT 1
  ),
  bill_totals AS (
    SELECT
      COALESCE(SUM(sb.grand_total), 0) AS gross_sales,
      COALESCE(SUM(sb.discount_total), 0) AS discount_total,
      COALESCE(SUM(sb.tax_total), 0) AS tax_total,
      COALESCE(SUM(sb.balance_amount), 0) AS due_total,
      COUNT(sb.id) AS bill_count
    FROM sales_bills sb
    WHERE sb.session_id = $1
  ),
  payment_totals AS (
    SELECT
      COALESCE(SUM(CASE WHEN sbp.method = 'cash' THEN sbp.amount ELSE 0 END), 0) AS cash_sales,
      COALESCE(SUM(CASE WHEN sbp.method = 'card' THEN sbp.amount ELSE 0 END), 0) AS card_sales,
      COALESCE(SUM(CASE WHEN sbp.method = 'upi' THEN sbp.amount ELSE 0 END), 0) AS upi_sales,
      COALESCE(SUM(CASE WHEN sb.payment_mode = 'split' THEN sbp.amount ELSE 0 END), 0) AS split_sales,
      COALESCE(SUM(sbp.amount), 0) AS paid_total
    FROM sales_bills sb
    LEFT JOIN sales_bill_payments sbp ON sbp.sales_bill_id = sb.id
    WHERE sb.session_id = $1
  ),
  withdrawal_totals AS (
    SELECT
      COALESCE(SUM(sct.amount), 0) AS cash_withdrawals
    FROM session_scope ss
    LEFT JOIN store_cash_transactions sct
      ON sct.store_id = ss.store_id
     AND sct.transaction_type = 'withdrawal'
     AND sct.created_at >= ss.session_start_at
     AND sct.meta->>'sessionId' = ss.session_id
  )
  SELECT
    COALESCE(($2::jsonb->>'opening_cash')::numeric, 0) AS opening_cash,
    payment_totals.cash_sales,
    withdrawal_totals.cash_withdrawals,
    payment_totals.card_sales,
    payment_totals.upi_sales,
    payment_totals.split_sales,
    bill_totals.gross_sales,
    bill_totals.discount_total,
    bill_totals.tax_total,
    bill_totals.due_total,
    payment_totals.paid_total,
    bill_totals.bill_count
  FROM bill_totals, payment_totals, withdrawal_totals
`;

export async function GET(request) {
  try {
    await ensureSalesBillingSchema();
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);

    const { searchParams } = new URL(request.url);
    const requestedSessionId = String(searchParams.get('sessionId') || searchParams.get('session_id') || '').trim();
    const sessionParams = [];
    const sessionWhere = [];

    if (requestedSessionId) {
      sessionParams.push(requestedSessionId);
      sessionWhere.push(`ucs.session_id = $${sessionParams.length}`);
    } else {
      sessionWhere.push('ucs.is_active = TRUE');
      if (auth.user.role !== 'super_admin') {
        sessionParams.push(auth.user.id);
        sessionWhere.push(`ucs.user_id = $${sessionParams.length}`);
      }
    }

    const sessionResult = await query(
      `SELECT ucs.id, ucs.user_id, ucs.counter_id, ucs.device_id, ucs.store_id,
              ucs.session_id, ucs.session_start_at, ucs.session_end_at, ucs.is_active,
              ucs.serial_number, ucs.counter_name, ucs.meta,
              u.name AS user_name, s.name AS store_name
       FROM user_counter_sessions ucs
       LEFT JOIN users u ON u.id = ucs.user_id
       LEFT JOIN stores s ON s.id = ucs.store_id
       WHERE ${sessionWhere.join(' AND ')}
       ORDER BY ucs.session_start_at DESC, ucs.id DESC
       LIMIT 1`,
      sessionParams
    );

    const session = sessionResult.rows[0];
    if (!session) {
      return successResponse({ session: null, closing: null });
    }

    if (auth.user.role !== 'super_admin') {
      const storeCheck = requireStore(auth.user, session.store_id);
      if (storeCheck.error) return storeCheck.error;
      if (session.user_id !== Number(auth.user.id) && !canManageSessions(auth.user)) {
        return errorResponse('You can only view your own POS session closing summary', 403);
      }
    }

    const totalsResult = await query(
      SESSION_TOTALS_SQL,
      [session.session_id, JSON.stringify(session.meta || {})]
    );

    const closingResult = await query(
      `SELECT *
       FROM cashier_closings
       WHERE session_id = $1
       LIMIT 1`,
      [session.session_id]
    );

    return successResponse({
      session: {
        id: session.id,
        sessionId: session.session_id,
        userId: session.user_id,
        counterId: session.counter_id,
        deviceId: session.device_id,
        storeId: session.store_id,
        userName: session.user_name || '',
        storeName: session.store_name || '',
        counterName: session.counter_name || '',
        openingCash: toNumber(session.meta?.opening_cash || 0),
        startedAt: session.session_start_at,
        isActive: session.is_active,
      },
      totals: mapClosingTotals(totalsResult.rows[0]),
      closing: closingResult.rows[0] || null,
    });
  } catch (err) {
    return errorResponse(err.message || 'Failed to load closing summary');
  }
}

export async function POST(request) {
  try {
    await ensureSalesBillingSchema();
    await ensureStoreCashSchema();
    const auth = await extractAuthUser(request);
    if (auth.error || !auth.user) return errorResponse(auth.error || 'Unauthorized', 401);

    const body = await request.json();
    const sessionId = String(body.sessionId || body.session_id || '').trim();
    const remarks = String(body.remarks || '').trim();
    const denominations = body.denominations && typeof body.denominations === 'object' ? body.denominations : {};

    if (!sessionId) {
      return validationError({ sessionId: 'Session id is required' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const sessionResult = await client.query(
        `SELECT id, session_id, user_id, store_id, counter_id, is_active, meta
         FROM user_counter_sessions
         WHERE session_id = $1
         LIMIT 1
         FOR UPDATE`,
        [sessionId]
      );

      const session = sessionResult.rows[0];
      if (!session) {
        await client.query('ROLLBACK');
        return notFoundError('Session not found');
      }
      if (!session.is_active) {
        await client.query('ROLLBACK');
        return errorResponse('Session is already closed', 409);
      }

      if (!canCloseSessionNow()) {
        await client.query('ROLLBACK');
        return errorResponse('POS sessions can only be closed after 9:00 PM IST', 409);
      }

      const storeCheck = requireStore(auth.user, session.store_id);
      if (storeCheck.error) {
        await client.query('ROLLBACK');
        return storeCheck.error;
      }
      if (session.user_id !== Number(auth.user.id) && !canManageSessions(auth.user)) {
        await client.query('ROLLBACK');
        return errorResponse('You can only close your own POS session', 403);
      }

      const openingCash = toNumber(session.meta?.opening_cash);
      const totalsResult = await client.query(SESSION_TOTALS_SQL, [
        sessionId,
        JSON.stringify({ ...(session.meta || {}), opening_cash: openingCash }),
      ]);

      const totals = mapClosingTotals(totalsResult.rows[0]);
      const cashSales = totals.cashSales;
      const cashWithdrawals = totals.cashWithdrawals;
      const expectedCash = Number((openingCash + cashSales - cashWithdrawals).toFixed(2));
      const actualCash = Math.max(0, toNumber(body.actualCash ?? body.actual_cash, expectedCash));
      const handoverAmount = Math.max(0, toNumber(body.handoverAmount ?? body.handover_amount, actualCash));
      const variance = Number((actualCash - expectedCash).toFixed(2));
      const handoverStatus = Math.abs(variance) > 0.01 ? 'variance_flagged' : 'pending_handover';
      const paymentBreakup = {
        ...totals,
        openingCash,
        cashWithdrawals,
        expectedCash,
        countedCash: actualCash,
        handoverAmount,
      };

      const closingInsert = await client.query(
        `INSERT INTO cashier_closings (
          session_id, user_id, store_id, opening_cash, expected_cash,
          actual_cash, counted_cash, handover_amount, manager_received_amount,
          variance, handover_status, handed_over_by, handed_over_at, denominations,
          payment_breakup, remarks, meta, closed_at, created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, 0,
          $9, $10, $11, NOW(), $12::jsonb,
          $13::jsonb, $14, $15::jsonb, NOW(), NOW()
        )
        RETURNING *`,
        [
          sessionId,
          session.user_id,
          session.store_id,
          openingCash,
          expectedCash,
          actualCash,
          actualCash,
          handoverAmount,
          variance,
          handoverStatus,
          auth.user.id,
          JSON.stringify(denominations),
          JSON.stringify(paymentBreakup),
          remarks || null,
          JSON.stringify({ ...body, flow: 'pending_manager_verification' }),
        ]
      );

      await client.query(
        `UPDATE user_counter_sessions
         SET is_active = FALSE,
             session_end_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE session_id = $2`,
        [JSON.stringify({ closing_id: closingInsert.rows[0].id, closed_at: new Date().toISOString() }), sessionId]
      );

      await client.query('COMMIT');

      return successResponse({
        closing: {
          id: closingInsert.rows[0].id,
          sessionId,
          openingCash,
          expectedCash,
          actualCash,
          countedCash: actualCash,
          handoverAmount,
          handoverStatus,
          variance,
          paymentBreakup,
          totals: paymentBreakup,
          remarks,
        },
      }, 'Cashier session closed. Cash is pending manager verification.', 201);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return errorResponse(err.message || 'Failed to close session');
  }
}
