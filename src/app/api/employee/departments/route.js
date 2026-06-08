import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureEmployeeDepartmentsSchema } from '@/lib/employeeDepartmentsSchema';
import { requireAuth, requirePermission } from '@/lib/api-protection';
import { setRecycleBinContext } from '@/lib/recycleBin';

function normalizeUserIds(input) {
  if (Array.isArray(input)) {
    return input
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  if (typeof input === 'string' && input.trim()) {
    return input
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  return [];
}

function mapDepartmentRow(row) {
  return {
    id: row.id,
    departmentId: row.id,
    departmentName: row.department_name,
    userIds: Array.isArray(row.user_ids) ? row.user_ids : [],
    description: row.description || '',
    createdAt: row.created_at,
  };
}

export async function GET() {
  try {
    await ensureEmployeeDepartmentsSchema();

    const res = await query(
      `SELECT id, department_name, user_ids, description, created_at
       FROM employee_departments
       ORDER BY created_at DESC, id DESC`
    );

    return NextResponse.json(res.rows.map(mapDepartmentRow));
  } catch (err) {
    console.error('[employee departments GET]', err.message);
    return NextResponse.json([]);
  }
}

export async function POST(request) {
  try {
    await ensureEmployeeDepartmentsSchema();

    const body = await request.json();
    const departmentName = String(body.department_name || body.departmentName || '').trim();
    const userIds = normalizeUserIds(body.user_ids || body.userIds || []);
    const description = String(body.description || '').trim();

    if (!departmentName) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO employee_departments (department_name, user_ids, description, meta, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, NOW(), NOW())
       RETURNING id, department_name, user_ids, description, created_at`,
      [departmentName, JSON.stringify(userIds), description || null, JSON.stringify(body)]
    );

    return NextResponse.json(mapDepartmentRow(res.rows[0]), { status: 201 });
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
    }

    console.error('[employee departments POST]', err.message);
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await ensureEmployeeDepartmentsSchema();

    const body = await request.json();
    const id = Number(body.id);
    const departmentName = String(body.department_name || body.departmentName || '').trim();
    const userIds = normalizeUserIds(body.user_ids || body.userIds || []);
    const description = String(body.description || '').trim();

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Department id is required' }, { status: 400 });
    }

    if (!departmentName) {
      return NextResponse.json({ error: 'Department name is required' }, { status: 400 });
    }

    const res = await query(
      `UPDATE employee_departments
       SET department_name = $1,
           user_ids = $2::jsonb,
           description = $3,
           meta = $4::jsonb,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, department_name, user_ids, description, created_at`,
      [departmentName, JSON.stringify(userIds), description || null, JSON.stringify(body), id]
    );

    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }

    return NextResponse.json(mapDepartmentRow(res.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
    }

    console.error('[employee departments PUT]', err.message);
    return NextResponse.json({ error: 'Failed to update department' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const client = await getClient();
  try {
    await ensureEmployeeDepartmentsSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_USERS');
    if (permissionCheck.error) return permissionCheck.error;

    const url = new URL(request.url);
    const id = Number(url.searchParams.get('id'));

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Department id is required' }, { status: 400 });
    }

    await client.query('BEGIN');
    await setRecycleBinContext(client, auth.user.id, 'Employee department deleted');
    const res = await client.query('DELETE FROM employee_departments WHERE id = $1 RETURNING id', [id]);

    if (res.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true, id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[employee departments DELETE]', err.message);
    return NextResponse.json({ error: 'Failed to delete department' }, { status: 500 });
  } finally {
    client.release();
  }
}
