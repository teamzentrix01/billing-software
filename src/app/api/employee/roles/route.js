import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureRolesSchema } from '@/lib/rolesSchema';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function normalizePermissions(input) {
  if (Array.isArray(input)) return input.filter(Boolean);
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function mapRoleRow(row) {
  return {
    id: row.id,
    roleId: row.id,
    roleName: row.role_name,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    description: row.description || '',
    createdAt: row.created_at,
  };
}

export async function GET(request) {
  try {
    await ensureRolesSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const res = await query(
      `SELECT id, role_name, permissions, description, created_at
       FROM roles
       ORDER BY created_at DESC, id DESC`
    );

    return NextResponse.json(res.rows.map(mapRoleRow));
  } catch (err) {
    console.error('[employee roles GET]', err.message);
    return NextResponse.json([]);
  }
}

export async function POST(request) {
  try {
    await ensureRolesSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_ROLES');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const roleName = String(body.role_name || body.roleName || '').trim();
    const permissions = normalizePermissions(body.permissions || body.permission || []);
    const description = String(body.description || '').trim();

    if (!roleName) {
      return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    }

    if (permissions.length === 0) {
      return NextResponse.json({ error: 'Permission is required' }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO roles (role_name, permissions, description, meta, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, NOW(), NOW())
       RETURNING id, role_name, permissions, description, created_at`,
      [roleName, JSON.stringify(permissions), description || null, JSON.stringify(body)]
    );

    return NextResponse.json(mapRoleRow(res.rows[0]), { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Role name already exists' }, { status: 409 });
    }

    console.error('[employee roles POST]', err.message);
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await ensureRolesSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_ROLES');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const id = Number(body.id);
    const roleName = String(body.role_name || body.roleName || '').trim();
    const permissions = normalizePermissions(body.permissions || body.permission || []);
    const description = String(body.description || '').trim();

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Role id is required' }, { status: 400 });
    }

    if (!roleName) {
      return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    }

    if (permissions.length === 0) {
      return NextResponse.json({ error: 'Permission is required' }, { status: 400 });
    }

    if (roleName === 'super_admin' && !(Array.isArray(auth.user.permissions) && auth.user.permissions.includes('*'))) {
      return NextResponse.json({ error: 'Only Super Admin (wildcard permission) can edit Super Admin role' }, { status: 403 });
    }

    const res = await query(
      `UPDATE roles
       SET role_name = $1,
           permissions = $2::jsonb,
           description = $3,
           meta = $4::jsonb,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, role_name, permissions, description, created_at`,
      [roleName, JSON.stringify(permissions), description || null, JSON.stringify(body), id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json(mapRoleRow(res.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Role name already exists' }, { status: 409 });
    }

    console.error('[employee roles PUT]', err.message);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const client = await getClient();
  try {
    await ensureRolesSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_ROLES');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Role id is required' }, { status: 400 });
    }

    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Employee role deleted');
    const res = await client.query(
      `DELETE FROM roles
       WHERE id = $1 AND COALESCE((meta->>'system')::boolean, FALSE) = FALSE
       RETURNING id`,
      [id]
    );

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[employee roles DELETE]', err.message);
    return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 });
  } finally {
    client.release();
  }
}
