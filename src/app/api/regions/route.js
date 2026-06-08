import { successResponse, errorResponse, validationError } from '@/lib/api-response';
import { getClient, query } from '@/lib/db';
import { ensureRegionsSchema } from '@/lib/regionsSchema';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function parsePositiveIntegerId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id) || id === '0') return null;
  return id;
}

function parseStoreIds(input) {
  if (!Array.isArray(input)) return [];

  const unique = new Set();
  input.forEach((value) => {
    const id = parsePositiveIntegerId(value);
    if (id) unique.add(id);
  });

  return Array.from(unique);
}

async function fetchRegionRecords() {
  const res = await query(
    `SELECT r.id,
            r.name,
            r.description,
            r.is_active,
            r.created_at,
            r.updated_at,
            COUNT(rsm.store_id)::INT AS store_count,
            COALESCE(
              JSONB_AGG(
                DISTINCT JSONB_BUILD_OBJECT('id', s.id, 'name', s.name)
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'::JSONB
            ) AS stores
     FROM regions r
     LEFT JOIN region_store_mappings rsm ON rsm.region_id = r.id
     LEFT JOIN stores s ON s.id = rsm.store_id
     GROUP BY r.id
     ORDER BY r.name ASC, r.id ASC`
  );

  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    isActive: row.is_active !== false,
    storeCount: Number(row.store_count || 0),
    storeIds: Array.isArray(row.stores) ? row.stores.map((store) => String(store.id)) : [],
    stores: Array.isArray(row.stores) ? row.stores : [],
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
}

export async function GET() {
  try {
    await ensureRegionsSchema();
    const records = await fetchRegionRecords();
    return successResponse({ records }, 'Regions fetched');
  } catch (err) {
    console.error('[regions GET]', err);
    return errorResponse('Failed to fetch regions');
  }
}

export async function POST(request) {
  await ensureRegionsSchema();

  const client = await getClient();
  try {
    const body = await request.json().catch(() => ({}));

    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const storeIds = parseStoreIds(body.storeIds);

    if (!name) {
      return validationError([{ field: 'name', message: 'Region name is required' }]);
    }

    await client.query('BEGIN');

    const insertRegion = await client.query(
      `INSERT INTO regions (name, description, is_active, created_at, updated_at)
       VALUES ($1, $2, TRUE, NOW(), NOW())
       RETURNING id`,
      [name, description || null]
    );

    const regionId = String(insertRegion.rows[0].id);

    if (storeIds.length > 0) {
      await client.query(
        'DELETE FROM region_store_mappings WHERE store_id = ANY($1::BIGINT[])',
        [storeIds]
      );

      await client.query(
        `INSERT INTO region_store_mappings (region_id, store_id)
         SELECT $1::BIGINT, UNNEST($2::BIGINT[])
         ON CONFLICT DO NOTHING`,
        [regionId, storeIds]
      );

      await client.query(
        `UPDATE stores
         SET region_id = $1::BIGINT,
             updated_at = NOW()
         WHERE id = ANY($2::BIGINT[])`,
        [regionId, storeIds]
      );
    }

    await client.query('COMMIT');

    const records = await fetchRegionRecords();
    const region = records.find((item) => String(item.id) === regionId) || null;

    return successResponse({ region }, 'Region created', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[regions POST]', err);

    if (String(err.message || '').toLowerCase().includes('duplicate key')) {
      return errorResponse('Region name already exists', 409);
    }

    return errorResponse('Failed to create region');
  } finally {
    client.release();
  }
}

export async function PUT(request) {
  await ensureRegionsSchema();

  const client = await getClient();
  try {
    const body = await request.json().catch(() => ({}));

    const regionId = parsePositiveIntegerId(body.id);
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const storeIds = parseStoreIds(body.storeIds);

    if (!regionId) {
      return validationError([{ field: 'id', message: 'Region id is required' }]);
    }

    if (!name) {
      return validationError([{ field: 'name', message: 'Region name is required' }]);
    }

    await client.query('BEGIN');

    const updateRegion = await client.query(
      `UPDATE regions
       SET name = $1,
           description = $2,
           updated_at = NOW()
       WHERE id = $3::BIGINT
       RETURNING id`,
      [name, description || null, regionId]
    );

    if (!updateRegion.rows.length) {
      await client.query('ROLLBACK');
      return errorResponse('Region not found', 404);
    }

    await client.query('DELETE FROM region_store_mappings WHERE region_id = $1::BIGINT', [regionId]);

    await client.query(
      `UPDATE stores
       SET region_id = NULL,
           updated_at = NOW()
       WHERE region_id = $1::BIGINT`,
      [regionId]
    );

    if (storeIds.length > 0) {
      await client.query(
        'DELETE FROM region_store_mappings WHERE store_id = ANY($1::BIGINT[])',
        [storeIds]
      );

      await client.query(
        `INSERT INTO region_store_mappings (region_id, store_id)
         SELECT $1::BIGINT, UNNEST($2::BIGINT[])
         ON CONFLICT DO NOTHING`,
        [regionId, storeIds]
      );

      await client.query(
        `UPDATE stores
         SET region_id = $1::BIGINT,
             updated_at = NOW()
         WHERE id = ANY($2::BIGINT[])`,
        [regionId, storeIds]
      );
    }

    await client.query('COMMIT');

    const records = await fetchRegionRecords();
    const region = records.find((item) => String(item.id) === regionId) || null;

    return successResponse({ region }, 'Region updated');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[regions PUT]', err);

    if (String(err.message || '').toLowerCase().includes('duplicate key')) {
      return errorResponse('Region name already exists', 409);
    }

    return errorResponse('Failed to update region');
  } finally {
    client.release();
  }
}

export async function DELETE(request) {
  await ensureRegionsSchema();

  const client = await getClient();
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_STORES');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const regionId = parsePositiveIntegerId(url.searchParams.get('id'));

    if (!regionId) {
      return validationError([{ field: 'id', message: 'Region id is required' }]);
    }

    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Region deleted');

    await client.query(
      `UPDATE stores
       SET region_id = NULL,
           updated_at = NOW()
       WHERE region_id = $1::BIGINT`,
      [regionId]
    );

    const deleteRegion = await client.query(
      'DELETE FROM regions WHERE id = $1::BIGINT RETURNING id',
      [regionId]
    );

    if (!deleteRegion.rows.length) {
      await client.query('ROLLBACK');
      return errorResponse('Region not found', 404);
    }

    await client.query('COMMIT');

    return successResponse({ id: regionId }, 'Region deleted');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[regions DELETE]', err);
    return errorResponse('Failed to delete region');
  } finally {
    client.release();
  }
}
