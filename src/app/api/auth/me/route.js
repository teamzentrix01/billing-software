import { cookies } from 'next/headers';
import { successResponse, errorResponse } from '@/lib/api-response';
import { verifyToken } from '@/lib/auth-enhanced';
import { query } from '@/lib/db';
import { ensureUsersTable } from '@/lib/userAuth';

export async function GET() {
  try {
    await ensureUsersTable();

    const cookieStore = await cookies();
    
    // Check for access_token (new system) or auth_token (legacy)
    const token = cookieStore.get('access_token')?.value || 
                  cookieStore.get('auth_token')?.value;

    if (!token) {
      return successResponse({ user: null }, 'Not authenticated');
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return successResponse({ user: null }, 'Not authenticated');
    }

    if (!payload?.sub) {
      return successResponse({ user: null }, 'Not authenticated');
    }

    const result = await query(
      `SELECT id, name, email, phone, role, is_active
       FROM users
       WHERE id = $1 AND is_active = TRUE
       LIMIT 1`,
      [payload.sub]
    );

    const dbUser = result.rows[0];

    if (!dbUser) {
      return successResponse({ user: null }, 'Not authenticated');
    }

    // Do not fetch role-based permissions here — permissions must come
    // from the employee record or from the token payload. Roles are
    // informational only.

    let employeeRoleName = null;
    let employeePermissions = null;
    let hasEmployeeProfile = false;
    try {
      const employeeResult = await query(
        `SELECT role_name, permissions
         FROM employees
         WHERE user_id = $1
            OR LOWER(email_address) = LOWER($2)
            OR LOWER(username) = LOWER($3)
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [dbUser.id, dbUser.email || '', dbUser.name || '']
      );
      if (employeeResult.rows.length > 0) {
        hasEmployeeProfile = true;
        employeeRoleName = employeeResult.rows[0]?.role_name || null;
        employeePermissions = Array.isArray(employeeResult.rows[0]?.permissions)
          ? employeeResult.rows[0].permissions
          : [];
      }
    } catch {}

    const storesResult = await query(
      `SELECT us.store_id, s.name AS store_name
       FROM user_stores us
       LEFT JOIN stores s ON s.id = us.store_id
       WHERE us.user_id = $1 AND us.is_active = TRUE
       ORDER BY s.name ASC, us.store_id ASC`,
      [dbUser.id]
    );

    // Super admins without an employee record get full wildcard access
    const isSuperAdmin = (dbUser.role === 'super_admin');
    const resolvedPermissions = isSuperAdmin && !hasEmployeeProfile && (employeePermissions === null || employeePermissions.length === 0)
      ? ['*']
      : employeePermissions !== null
        ? employeePermissions
        : (Array.isArray(payload.permissions) ? payload.permissions : []);
    const assignedStores = storesResult.rows.map((row) => Number(row.store_id));
    const effectiveRole =
      hasEmployeeProfile && dbUser.role === 'super_admin'
        ? 'admin'
        : dbUser.role || 'user';

    // Construct user object from token + latest database access rules
    const user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || dbUser.email,
      role: effectiveRole,
      system_role: dbUser.role || 'user',
      role_name: employeeRoleName || dbUser.role || 'user',
      permissions: resolvedPermissions,
      assigned_stores: assignedStores,
      is_employee: hasEmployeeProfile,
      assigned_store_names: storesResult.rows
        .map((row) => row.store_name)
        .filter(Boolean),
    };

    return successResponse({ user }, 'Authenticated');
  } catch (err) {
    console.error('[AUTH/ME] Error:', err.message);
    return errorResponse(err.message || 'Unable to fetch current user');
  }
}
