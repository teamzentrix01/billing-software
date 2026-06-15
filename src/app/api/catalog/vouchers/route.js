import { query } from '@/lib/db';
import { successResponse, errorResponse, validationError } from '@/lib/apiResponse';
import { ensureVouchersSchema } from '@/lib/catalogExtrasSchema';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { formatIndianDate } from '@/lib/dateUtils';

function toNum(v, fallback = 0) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v, fallback = 0) {
  return Math.floor(toNum(v, fallback));
}

function formatDate(d) {
  return formatIndianDate(d, '—');
}

function formatValue(row) {
  const type = String(row.voucher_type || 'ABSOLUTE').toUpperCase();
  const val = Number(row.value || 0);
  if (type === 'PERCENTAGE') return `${val}%`;
  return `₹${val.toFixed(2)}`;
}

// ─── GET /api/catalog/vouchers ───────────────────────────────
export async function GET(request) {
  try {
    await ensureVouchersSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'VIEW_CATALOG', 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '10', 10)));
    const offset = (page - 1) * pageSize;

    const params = [];
    let where = '';
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where = `WHERE (
        v.code ILIKE $1
        OR COALESCE(v.description, '') ILIKE $1
        OR COALESCE(v.device_id, '') ILIKE $1
      )`;
    }

    const count = await query(`SELECT COUNT(*)::int AS n FROM vouchers v ${where}`, params);
    const total = count.rows[0].n;

    const limIdx = params.length + 1;
    const offIdx = params.length + 2;
    const listParams = [...params, pageSize, offset];

    const result = await query(
      `SELECT
         v.id,
         v.code,
         v.description,
         v.valid_from,
         v.valid_to,
         v.expiry_date,
         v.voucher_type,
         v.value,
         v.max_voucher_value,
         v.min_order,
         v.allocated_count,
         v.available_count,
         v.redeemed_count,
         v.used_count,
         v.is_used,
         v.customer_id,
         v.store_id,
         v.device_id,
         v.is_blocked,
         v.is_active,
         v.created_at,
         TRIM(CONCAT(c.first_name, ' ', COALESCE(c.last_name, ''))) AS customer_name,
         s.name AS store_name
       FROM vouchers v
       LEFT JOIN customers c ON c.id = v.customer_id
       LEFT JOIN stores s ON s.id = v.store_id
       ${where}
       ORDER BY v.id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      listParams
    );

    const records = result.rows.map((row) => {
      const redeemed = toInt(row.redeemed_count ?? row.used_count, 0);
      const allocated = toInt(row.allocated_count, 0);
      const available =
        row.available_count != null ? toInt(row.available_count, 0) : Math.max(0, allocated - redeemed);

      return {
        ...row,
        valid_from_label: formatDate(row.valid_from),
        valid_to_label: formatDate(row.valid_to || row.expiry_date),
        value_label: formatValue(row),
        max_voucher_value_label:
          Number(row.max_voucher_value || 0) > 0
            ? `₹${Number(row.max_voucher_value).toFixed(2)}`
            : '—',
        allocated: allocated || '—',
        available,
        redeemed,
        is_used_label: row.is_used || redeemed > 0 ? 'Yes' : 'No',
        customer_label: row.customer_name || '—',
        store_label: row.store_name || '—',
        device_id_label: row.device_id || '—',
      };
    });

    return successResponse({
      records,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    return errorResponse(err.message);
  }
}

// ─── POST /api/catalog/vouchers ──────────────────────────────
export async function POST(request) {
  try {
    await ensureVouchersSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const code = String(body.code || '').trim();
    if (!code) return validationError({ code: 'Voucher code is required' });

    const valueRaw = body.value;
    if (valueRaw === '' || valueRaw === null || valueRaw === undefined) {
      return validationError({ value: 'Voucher value is required' });
    }

    const allocated = toInt(body.allocated_count ?? body.voucher_count ?? body.voucherCount, 0);
    if (!allocated) {
      return validationError({ voucher_count: 'Voucher count to distribute is required' });
    }

    const validFrom = body.valid_from || body.validFrom || null;
    const validTo = body.valid_to || body.validTo || body.expiry_date || null;
    if (!validFrom || !validTo) {
      return validationError({ valid_from: 'Date range is required' });
    }

    const voucherType = String(body.voucher_type || body.voucherType || 'ABSOLUTE').toUpperCase();
    const value = toNum(valueRaw, 0);
    const maxValue = toNum(body.max_voucher_value ?? body.maxVoucherValue, value);

    const result = await query(
      `INSERT INTO vouchers (
        code,
        description,
        valid_from,
        valid_to,
        expiry_date,
        voucher_type,
        value,
        max_voucher_value,
        min_order,
        allocated_count,
        available_count,
        redeemed_count,
        used_count,
        is_used,
        is_active,
        is_blocked,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $4, $5, $6, $7, COALESCE($8, 0),
        $9, $9, 0, 0, false, true, false, NOW(), NOW()
      ) RETURNING *`,
      [
        code,
        body.description?.trim() || null,
        String(validFrom).slice(0, 10),
        String(validTo).slice(0, 10),
        voucherType,
        value,
        maxValue,
        toNum(body.min_order ?? body.minOrder, 0),
        allocated,
      ]
    );

    return successResponse(result.rows[0], 'Voucher created successfully', 201);
  } catch (err) {
    if (err.code === '23505') return errorResponse('Voucher code already exists', 409);
    return errorResponse(err.message);
  }
}
