import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, notFound, validationError } from '@/lib/apiResponse';
import { ensureCatalogExtrasSchema } from '@/lib/catalogExtrasSchema';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function toDateString(v) {
  if (!v) return null;
  try { return String(v).slice(0, 10); } catch { return null; }
}

function safeNumber(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function ensurePromotionsColumns() {
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS store_id BIGINT`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS discount_applied_on VARCHAR(60) NOT NULL DEFAULT 'ORDER'`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS max_repeat_count INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS use_for_customer BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS remove_other_discounts BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS is_auto_applied BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS min_cart_value NUMERIC(14,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS max_discount_value NUMERIC(14,2) NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS apply_after_tax BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS allow_merging BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS apply_on_product_mrp BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS description TEXT`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS products JSONB`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS coupon_enabled BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE promotions ADD COLUMN IF NOT EXISTS promotion_slots_enabled BOOLEAN NOT NULL DEFAULT false`);
}

export async function PUT(request, { params }) {
  try {
    await ensureCatalogExtrasSchema();
    await ensurePromotionsColumns();

    const p = await params;
    const id = Number(p?.id);
    if (!id) return errorResponse('Invalid promotion id', 400);

    const body = await request.json().catch(() => ({}));

    const promotionType = body.promotion_type !== undefined ? body.promotion_type : (body.type !== undefined ? body.type : null);
    const discountValue = body.discount_value !== undefined ? body.discount_value : (body.discount !== undefined ? body.discount : null);
    const startDate = body.start_date !== undefined || body.startDate !== undefined ? toDateString(body.start_date || body.startDate) : null;
    const endDate = body.end_date !== undefined || body.endDate !== undefined ? toDateString(body.end_date || body.endDate) : null;

    const storeId = safeNumber(body.store_id, null);
    const discountAppliedOn = body.discount_applied_on !== undefined ? body.discount_applied_on : (body.discountAppliedOn !== undefined ? body.discountAppliedOn : null);
    const maxRepeatCount = safeNumber(body.max_repeat_count ?? body.maxRepeatCount, null);
    const useForCustomer = body.use_for_customer !== undefined ? !!body.use_for_customer : (body.useForCustomer !== undefined ? !!body.useForCustomer : null);
    const removeOtherDiscounts = body.remove_other_discounts !== undefined ? !!body.remove_other_discounts : (body.removeOtherDiscounts !== undefined ? !!body.removeOtherDiscounts : null);
    const isAutoApplied = body.is_auto_applied !== undefined ? !!body.is_auto_applied : (body.isAutoApplied !== undefined ? !!body.isAutoApplied : null);
    const minCartValue = safeNumber(body.min_cart_value ?? body.minCartValue, null);
    const maxDiscountValue = safeNumber(body.max_discount_value ?? body.maxDiscountValue, null);
    const applyAfterTax = body.apply_after_tax !== undefined ? !!body.apply_after_tax : (body.applyAfterTax !== undefined ? !!body.applyAfterTax : null);
    const allowMerging = body.allow_merging !== undefined ? !!body.allow_merging : (body.allowMerging !== undefined ? !!body.allowMerging : null);
    const applyOnProductMrp = body.apply_on_product_mrp !== undefined ? !!body.apply_on_product_mrp : (body.applyOnProductMrp !== undefined ? !!body.applyOnProductMrp : null);
    const description = body.description ? String(body.description) : null;
    let products = null;
    if (body.products) {
      if (Array.isArray(body.products)) products = body.products;
      else if (typeof body.products === 'string') products = body.products.split(',').map(s => s.trim()).filter(Boolean);
    }
    const couponEnabled = !!body.coupon_enabled || !!body.couponEnabled;
    const promotionSlotsEnabled = !!body.promotion_slots_enabled || !!body.promotionSlotsEnabled;

    const result = await query(
      `UPDATE promotions SET
        name = COALESCE($1, name),
        promotion_type = COALESCE($2, promotion_type),
        discount_value = COALESCE($3, discount_value),
        start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date),
        status = COALESCE($6, status),
        store_id = COALESCE($7, store_id),
        discount_applied_on = COALESCE($8, discount_applied_on),
        max_repeat_count = COALESCE($9, max_repeat_count),
        use_for_customer = COALESCE($10, use_for_customer),
        remove_other_discounts = COALESCE($11, remove_other_discounts),
        is_auto_applied = COALESCE($12, is_auto_applied),
        min_cart_value = COALESCE($13, min_cart_value),
        max_discount_value = COALESCE($14, max_discount_value),
        apply_after_tax = COALESCE($15, apply_after_tax),
        allow_merging = COALESCE($16, allow_merging),
        apply_on_product_mrp = COALESCE($17, apply_on_product_mrp),
        description = COALESCE($18, description),
        products = COALESCE($19, products),
        coupon_enabled = COALESCE($20, coupon_enabled),
        promotion_slots_enabled = COALESCE($21, promotion_slots_enabled),
        updated_at = NOW()
       WHERE id = $22::int RETURNING *`,
      [
        body.name !== undefined ? String(body.name).trim() : null,
        promotionType,
        discountValue !== undefined && discountValue !== null ? String(discountValue) : null,
        startDate,
        endDate,
        body.status !== undefined ? body.status : null,
        storeId,
        discountAppliedOn,
        maxRepeatCount,
        useForCustomer,
        removeOtherDiscounts,
        isAutoApplied,
        minCartValue,
        maxDiscountValue,
        applyAfterTax,
        allowMerging,
        applyOnProductMrp,
        description,
        products ? JSON.stringify(products) : null,
        couponEnabled,
        promotionSlotsEnabled,
        id,
      ]
    );

    if (!result.rows.length) return notFound('Promotion not found');
    return successResponse(result.rows[0], 'Promotion updated successfully');
  } catch (err) {
    if (err.code === '23505') return errorResponse('Promotion already exists', 409);
    return errorResponse(err.message);
  }
}

export async function DELETE(request, { params }) {
  let client;
  try {
    await ensureCatalogExtrasSchema();
    await ensurePromotionsColumns();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_CATALOG');
    if (permissionCheck.error) return permissionCheck.error;

    const p = await params;
    const id = Number(p?.id);
    if (!id) return errorResponse('Invalid promotion id', 400);

    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Promotion deleted');
    const result = await client.query(`DELETE FROM promotions WHERE id = $1::int RETURNING *`, [id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return notFound('Promotion not found');
    }
    await client.query('COMMIT');
    return successResponse(null, 'Promotion deleted');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return errorResponse(err.message);
  } finally {
    client?.release();
  }
}
