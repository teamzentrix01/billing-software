/**
 * API PROTECTION LAYER
 * Provides middleware functions for role-based and permission-based access control
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth-enhanced';
import { query } from '@/lib/db';
import { unauthorizedError, forbiddenError } from '@/lib/api-response';
import { ensureUsersTable } from '@/lib/userAuth';
import { ensureAuditLogsSchema } from '@/lib/auditLogsSchema';
import { ensureRecycleBinSchema } from '@/lib/recycleBinSchema';


/**
 * Extract and verify JWT token from request
 * Returns { user, token, error }
 */
export async function extractAuthUser(request) {
  try {
    await ensureUsersTable();
    await ensureRecycleBinSchema().catch((err) => {
      console.warn('[API_PROTECTION] Recycle bin schema could not be ensured:', err.message);
    });

    // Get token from cookies or Authorization header
    const cookieToken = request.cookies.get('access_token')?.value || 
                       request.cookies.get('auth_token')?.value;
    
    const authHeader = request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    const token = bearerToken || cookieToken;

    if (!token) {
      return { user: null, token: null, error: 'No authentication token provided' };
    }

    // Verify token
    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      return { user: null, token: null, error: 'Invalid or expired token' };
    }

    if (!payload?.sub) {
      return { user: null, token: null, error: 'Invalid or expired token' };
    }

    // Fetch full user from database
    const userResult = await query(
      `SELECT id, name, email, phone, role, is_active
       FROM users
       WHERE id = $1 AND is_active = TRUE`,
      [payload.sub]
    );

    if (userResult.rows.length === 0) {
      return { user: null, token: null, error: 'User not found or inactive' };
    }

    const dbUser = userResult.rows[0];
    let permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    let employeeRoleName = null;
    let employeePermissions = null;

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
        employeeRoleName = employeeResult.rows[0]?.role_name || null;
        employeePermissions = Array.isArray(employeeResult.rows[0]?.permissions)
          ? employeeResult.rows[0].permissions
          : [];
      }

      if (employeePermissions !== null) {
        permissions = employeePermissions;
      }
    } catch {}

    if (dbUser.role === 'super_admin' && permissions.length === 0) {
      permissions = ['*'];
    }

    let assignedStores = payload.assigned_stores || [];
    try {
      const storeResult = await query(
        `SELECT store_id FROM user_stores WHERE user_id = $1 AND is_active = TRUE ORDER BY store_id`,
        [dbUser.id]
      );
      assignedStores = storeResult.rows.map((row) => Number(row.store_id));
    } catch {}

    const user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name || dbUser.email,
      role: dbUser.role || 'user',
      role_name: employeeRoleName || dbUser.role || 'user',
      permissions,
      assigned_stores: assignedStores,
    };

    return { user, token, error: null };
  } catch (err) {
    console.error('[API_PROTECTION] Error extracting user:', err.message);
    return { user: null, token: null, error: err.message };
  }
}

/**
 * MIDDLEWARE: Require authentication
 * Must be called at start of protected endpoints
 * 
 * Usage:
 * export async function POST(request) {
 *   const auth = await requireAuth(request);
 *   if (auth.error) return auth.error;
 *   const { user } = auth;
 *   // ... rest of endpoint
 * }
 */
export async function requireAuth(request) {
  const { user, token, error } = await extractAuthUser(request);

  if (error || !user) {
    return {
      error: unauthorizedError(error || 'Authentication required'),
      user: null,
    };
  }

  return { error: null, user };
}

/**
 * MIDDLEWARE: Require specific role(s)
 * 
 * Usage:
 * const auth = await requireAuth(request);
 * if (auth.error) return auth.error;
 * 
 * const roleCheck = requireRole(auth.user, 'super_admin', 'admin');
 * if (roleCheck.error) return roleCheck.error;
 */
export function requireRole(user, ...roles) {
  if (!user) {
    return { error: unauthorizedError('Not authenticated') };
  }

  if (!roles.includes(user.role)) {
    return {
      error: forbiddenError(
        `Access denied. Required role(s): ${roles.join(', ')}, but you are: ${user.role}`
      ),
    };
  }

  return { error: null };
}

/**
 * MIDDLEWARE: Require specific permission(s)
 * 
 * Usage:
 * const auth = await requireAuth(request);
 * const permCheck = requirePermission(auth.user, 'users:create', 'users:edit');
 * if (permCheck.error) return permCheck.error;
 */
export function requirePermission(user, ...permissions) {
  if (!user) {
    return { error: unauthorizedError('Not authenticated') };
  }

  const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
  const hasPermission =
    user.role === 'super_admin' ||
    userPerms.includes('*') ||
    permissions.some((p) => userPerms.includes(p));

  if (!hasPermission) {
    return {
      error: forbiddenError(
        `Access denied. Required permission(s): ${permissions.join(', ')}`
      ),
    };
  }

  return { error: null };
}

/**
 * MIDDLEWARE: Verify user can access store
 * 
 * Usage:
 * const storeCheck = requireStore(user, storeId);
 * if (storeCheck.error) return storeCheck.error;
 */
export function requireStore(user, storeId) {
  if (!user) {
    return { error: unauthorizedError('Not authenticated') };
  }

  if (user.role === 'super_admin') return { error: null };

  // Check if user is assigned to this store
  if (!user.assigned_stores.includes(Number(storeId))) {
    return {
      error: forbiddenError(
        `You don't have access to store ${storeId}. Assigned stores: ${user.assigned_stores.join(', ')}`
      ),
    };
  }

  return { error: null };
}

export function getAssignedStoreIds(user) {
  return (user?.assigned_stores || []).map(Number).filter(Number.isFinite);
}

export function canAccessAllStores(user) {
  return user?.role === 'super_admin';
}

export function getStoreScope(user, requestedStoreId = null) {
  const storeId = Number(requestedStoreId || 0) || null;

  if (storeId) {
    const storeCheck = requireStore(user, storeId);
    if (storeCheck.error) return { error: storeCheck.error, storeIds: [] };
    return { error: null, storeIds: [storeId] };
  }

  if (canAccessAllStores(user)) {
    return { error: null, storeIds: null };
  }

  return { error: null, storeIds: getAssignedStoreIds(user) };
}

export function appendStoreScope(whereClauses, params, columnName, user, requestedStoreId = null) {
  const scope = getStoreScope(user, requestedStoreId);
  if (scope.error) return scope;

  if (scope.storeIds === null) return scope;

  if (!scope.storeIds.length) {
    whereClauses.push('1 = 0');
    return scope;
  }

  params.push(scope.storeIds);
  whereClauses.push(`${columnName} = ANY($${params.length}::int[])`);
  return scope;
}

/**
 * LOG API ACCESS for audit trail
 */
export async function auditLog(userId, action, resourceType, resourceId = null, details = {}) {
  try {
    await ensureAuditLogsSchema();
    const normalizedResourceId = Number(resourceId);
    await query(
      `INSERT INTO audit_logs 
       (user_id, action, resource_type, resource_id, status, details, metadata, created_at)
       VALUES ($1, $2, $3, $4, 'success', $5::jsonb, $5::jsonb, NOW())`,
      [
        Number(userId) || null,
        action,
        resourceType,
        Number.isFinite(normalizedResourceId) ? normalizedResourceId : null,
        JSON.stringify(details || {}),
      ]
    );
  } catch (err) {
    console.error('[AUDIT_LOG] Error logging:', err.message);
  }
}

/**
 * Get user's IP address from request
 */
export function getUserIP(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-real-ip') ||
         'unknown';
}
