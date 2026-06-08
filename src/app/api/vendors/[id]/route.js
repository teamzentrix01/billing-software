import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureVendorsSchema } from '@/lib/vendorsSchema';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function mapVendor(r) {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    business: r.business,
    address_1: r.address_1,
    address_2: r.address_2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    country: r.country,
    email: r.email,
    mobile_number: r.mobile_number,
    gst_number: r.gst_number,
    margin: Number(r.margin || 0),
    is_active: r.is_active !== false,
    brand_ids: Array.isArray(r.brand_ids)
      ? r.brand_ids.map((brandId) => String(brandId))
      : [],
    brands: Array.isArray(r.brands) ? r.brands.filter(Boolean) : [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function normalizeBrandIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];
}

async function saveVendorBrands(vendorId, brandIds) {
  await query('DELETE FROM vendor_brands WHERE vendor_id = $1', [vendorId]);
  if (!brandIds.length) return;
  await query(
    `INSERT INTO vendor_brands (vendor_id, brand_id)
     SELECT $1, id
     FROM brands
     WHERE id = ANY($2::int[])
     ON CONFLICT DO NOTHING`,
    [vendorId, brandIds],
  );
}

function normalizePayload(body) {
  const normalizedMobile = String(body.mobile_number || '').replace(/\D/g, '');
  const normalizedEmail = String(body.email || '').trim().toLowerCase();
  if (!String(body.name || '').trim()) throw new Error('Name is required');
  if (!normalizedMobile) throw new Error('Mobile number is required');
  if (!/^\d{10}$/.test(normalizedMobile)) throw new Error('Mobile number must be exactly 10 digits');
  if (!String(body.gst_number || '').trim()) throw new Error('GST number is required');
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error('Enter a valid email address');
  const phoneValidation = validatePhoneNumber(normalizedMobile);
  if (!phoneValidation.isValid) throw new Error(phoneValidation.error);

  return {
    name: String(body.name).trim(),
    company: body.company || null,
    business: body.business || null,
    address_1: body.address_1 || null,
    address_2: body.address_2 || null,
    city: body.city || null,
    state: body.state || null,
    pincode: body.pincode || null,
    country: body.country || null,
    email: normalizedEmail || null,
    mobile_number: normalizedMobile,
    gst_number: String(body.gst_number).trim(),
    margin: Number(body.margin || 0),
    is_active: body.is_active !== false,
    brand_ids: normalizeBrandIds(body.brand_ids),
  };
}

export async function GET(request, context) {
  try {
    await ensureVendorsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_VENDORS', 'MANAGE_PURCHASE_ORDERS');
    if (permissionCheck.error) return permissionCheck.error;
    const { id } = await context.params;
    const res = await query(
          `SELECT v.id, v.name, v.company, v.business, v.address_1, v.address_2, v.city, v.state, v.pincode, v.country,
            v.email, v.mobile_number, v.gst_number, v.margin, v.is_active, v.created_at, v.updated_at,
            COALESCE(ARRAY_AGG(b.id ORDER BY b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS brand_ids,
            COALESCE(ARRAY_AGG(b.name ORDER BY b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS brands
       FROM vendors v
       LEFT JOIN vendor_brands vb ON vb.vendor_id = v.id
       LEFT JOIN brands b ON b.id = vb.brand_id
       WHERE v.id = $1
       GROUP BY v.id`,
      [id]
    );
    if (!res.rows[0]) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    return NextResponse.json(mapVendor(res.rows[0]));
  } catch (err) {
    console.error('[vendors GET id]', err.message);
    return NextResponse.json({ error: 'Failed to load vendor' }, { status: 500 });
  }
}

export async function PUT(request, context) {
  try {
    await ensureVendorsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_VENDORS');
    if (permissionCheck.error) return permissionCheck.error;
    const { id } = await context.params;
    const payload = normalizePayload(await request.json());
    const res = await query(
      `UPDATE vendors SET
         name = $1,
         company = $2,
         business = $3,
         address_1 = $4,
         address_2 = $5,
         city = $6,
         state = $7,
         pincode = $8,
         country = $9,
         email = $10,
         mobile_number = $11,
         gst_number = $12,
         margin = $13,
         is_active = $14,
         updated_at = NOW()
       WHERE id = $15
       RETURNING id, name, company, business, address_1, address_2, city, state, pincode, country,
                 email, mobile_number, gst_number, margin, is_active, created_at, updated_at`,
      [
        payload.name,
        payload.company,
        payload.business,
        payload.address_1,
        payload.address_2,
        payload.city,
        payload.state,
        payload.pincode,
        payload.country,
        payload.email,
        payload.mobile_number,
        payload.gst_number,
        payload.margin,
        payload.is_active,
        id,
      ]
    );
    if (!res.rows[0]) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    await saveVendorBrands(id, payload.brand_ids);
    return NextResponse.json(mapVendor({ ...res.rows[0], brand_ids: payload.brand_ids }));
  } catch (err) {
    console.error('[vendors PUT id]', err.message);
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Vendor with same mobile or email already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message || 'Failed to update vendor' }, { status: 500 });
  }
}

export async function DELETE(request, context) {
  let client;
  try {
    await ensureVendorsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_VENDORS');
    if (permissionCheck.error) return permissionCheck.error;
    const { id } = await context.params;
    const usage = await query(
      `SELECT
         (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = $1)::int AS purchase_orders,
         (SELECT COUNT(*) FROM vendor_invoices WHERE vendor_id = $1)::int AS vendor_invoices`,
      [id]
    ).catch(() => ({ rows: [{ purchase_orders: 0, vendor_invoices: 0 }] }));
    const counts = usage.rows[0] || {};
    if (Number(counts.purchase_orders || 0) > 0 || Number(counts.vendor_invoices || 0) > 0) {
      await query('UPDATE vendors SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
      return NextResponse.json({ success: true, archived: true });
    }
    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Vendor deleted');
    const res = await client.query('DELETE FROM vendors WHERE id = $1 RETURNING id', [id]);
    if (!res.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 });
    }
    await client.query('COMMIT');
    return NextResponse.json({ success: true, deleted: true });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[vendors DELETE id]', err.message);
    return NextResponse.json({ error: 'Failed to delete vendor' }, { status: 500 });
  } finally {
    client?.release();
  }
}
