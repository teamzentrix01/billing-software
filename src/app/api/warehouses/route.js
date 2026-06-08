import { getClient, query } from '@/lib/db';
import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { ensureStoresSchema } from '@/lib/storesSchema';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parsePositiveIntegerId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id) || id === '0') return null;
  return id;
}

export async function GET() {
  try {
    await ensureStoresSchema();

    const res = await query(
      `SELECT id, name, address_line1, address_line2, city, state, pincode, country,
              manager_mobile, manager_email, meta, is_active, created_at, updated_at
       FROM stores
       WHERE COALESCE(meta->>'locationType', 'Warehouse') = 'Warehouse'
       ORDER BY created_at DESC, id DESC`
    );
    return successResponse({ records: res.rows }, 'Warehouses fetched');
  } catch (err) {
    console.error(err);
    return errorResponse('Failed to fetch warehouses');
  }
}

export async function POST(request) {
  try {
    await ensureStoresSchema();

    const body = await request.json();
    const name = String(body.name || '').trim();
    const mobileNumber = String(body.mobileNumber || '').replace(/\D/g, '');
    const email = String(body.email || body.warehouseEmail || '').trim().toLowerCase();

    if (!name) {
      return validationError([{ field: 'name', message: 'Warehouse name is required' }]);
    }

    if (!mobileNumber) {
      return validationError([{ field: 'mobileNumber', message: 'Mobile number is required' }]);
    }
    if (!/^\d{10}$/.test(mobileNumber)) {
      return validationError([{ field: 'mobileNumber', message: 'Mobile number must be exactly 10 digits' }]);
    }

    if (!email) {
      return validationError([{ field: 'email', message: 'Warehouse email is required' }]);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return validationError([{ field: 'email', message: 'Enter a valid warehouse email' }]);
    }

    const users = parseList(body.users ?? body.userIds);
    const notificationEmails = parseList(body.notificationEmails);

    const meta = {
      locationType: 'Warehouse',
      users,
      gstNumber: String(body.gstNumber || '').trim(),
      notificationEmails,
    };

    const fullMobile = `+91 ${mobileNumber}`.trim();

    const res = await query(
      `INSERT INTO stores (
         name, address_line1, address_line2, city, state, pincode, country,
         manager_mobile, manager_email, meta, is_active, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10::jsonb, TRUE, NOW(), NOW()
       )
       RETURNING id, name, address_line1, address_line2, city, state, pincode, country,
                 manager_mobile, manager_email, meta, is_active, created_at, updated_at`,
      [
        name,
        body.addressLine1 || null,
        body.addressLine2 || null,
        body.city || null,
        body.state || null,
        body.pincode || null,
        body.country || 'India',
        fullMobile,
        email,
        JSON.stringify(meta),
      ]
    );

    return successResponse({ warehouse: res.rows[0] }, 'Warehouse created', 201);
  } catch (err) {
    console.error(err);
    return errorResponse(err.message || 'Failed to create warehouse');
  }
}

export async function PUT(request) {
  try {
    await ensureStoresSchema();

    const body = await request.json();
    const id = parsePositiveIntegerId(body.id);
    const name = String(body.name || '').trim();
    const mobileNumber = String(body.mobileNumber || '').replace(/\D/g, '');
    const email = String(body.email || body.warehouseEmail || '').trim().toLowerCase();

    if (!id) {
      return validationError([{ field: 'id', message: 'Warehouse id is required' }]);
    }

    if (!name) {
      return validationError([{ field: 'name', message: 'Warehouse name is required' }]);
    }

    if (!mobileNumber) {
      return validationError([{ field: 'mobileNumber', message: 'Mobile number is required' }]);
    }
    if (!/^\d{10}$/.test(mobileNumber)) {
      return validationError([{ field: 'mobileNumber', message: 'Mobile number must be exactly 10 digits' }]);
    }

    const phoneValidation = validatePhoneNumber(mobileNumber);
    if (!phoneValidation.isValid) {
      return validationError([{ field: 'mobileNumber', message: phoneValidation.error }]);
    }

    if (!email) {
      return validationError([{ field: 'email', message: 'Warehouse email is required' }]);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return validationError([{ field: 'email', message: 'Enter a valid warehouse email' }]);
    }

    const users = parseList(body.users ?? body.userIds);
    const notificationEmails = parseList(body.notificationEmails);

    const meta = {
      locationType: 'Warehouse',
      users,
      gstNumber: String(body.gstNumber || '').trim(),
      notificationEmails,
    };

    const fullMobile = `+91 ${mobileNumber}`.trim();

    const res = await query(
      `UPDATE stores
       SET name = $1,
           address_line1 = $2,
           address_line2 = $3,
           city = $4,
           state = $5,
           pincode = $6,
           country = $7,
           manager_mobile = $8,
           manager_email = $9,
           meta = $10::jsonb,
           updated_at = NOW()
       WHERE id = $11::bigint
         AND COALESCE(meta->>'locationType', 'Warehouse') = 'Warehouse'
       RETURNING id, name, address_line1, address_line2, city, state, pincode, country,
                 manager_mobile, manager_email, meta, is_active, created_at, updated_at`,
      [
        name,
        body.addressLine1 || null,
        body.addressLine2 || null,
        body.city || null,
        body.state || null,
        body.pincode || null,
        body.country || 'India',
        fullMobile,
        email,
        JSON.stringify(meta),
        id,
      ]
    );

    if (!res.rows.length) {
      return errorResponse('Warehouse not found', 404);
    }

    return successResponse({ warehouse: res.rows[0] }, 'Warehouse updated');
  } catch (err) {
    console.error(err);
    return errorResponse(err.message || 'Failed to update warehouse');
  }
}

export async function DELETE(request) {
  let client;
  try {
    await ensureStoresSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_STORES');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const id = parsePositiveIntegerId(url.searchParams.get('id'));

    if (!id) {
      return validationError([{ field: 'id', message: 'Warehouse id is required' }]);
    }

    client = await getClient();
    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Warehouse deleted');
    const res = await client.query(
      `DELETE FROM stores
       WHERE id = $1::bigint
         AND COALESCE(meta->>'locationType', 'Warehouse') = 'Warehouse'
       RETURNING id`,
      [id]
    );

    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return errorResponse('Warehouse not found', 404);
    }

    await client.query('COMMIT');
    return successResponse({ id }, 'Warehouse deleted');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return errorResponse(err.message || 'Failed to delete warehouse');
  } finally {
    client?.release();
  }
}
