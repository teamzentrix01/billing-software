/**
 * PHASE 1 - STEP 2: Request Context Helper
 * 
 * Purpose: Easily extract user from request in API routes
 * Usage: const user = getCurrentUser(request);
 */

import { verifyToken } from './auth-enhanced';

// ============================================
// GET CURRENT USER FROM REQUEST
// ============================================

export function getCurrentUser(request) {
  try {
    // Try to get token from cookies
    let token = request.cookies?.get?.('access_token')?.value;

    // Try alternative cookie name
    if (!token) {
      token = request.cookies?.get?.('auth_token')?.value;
    }

    // Try to get from Authorization header
    if (!token && request.headers?.get?.('authorization')) {
      const authHeader = request.headers.get('authorization');
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return null;
    }

    // Verify and decode token
    const decoded = verifyToken(token);
    if (!decoded) {
      return null;
    }

    // Return user object
    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      permissions: decoded.permissions || [],
      assigned_stores: decoded.assigned_stores || [],
      token, // Include token for potential refresh scenarios
    };
  } catch (err) {
    console.error('[getCurrentUser]', err.message);
    return null;
  }
}

// ============================================
// CHECK IF USER HAS PERMISSION
// ============================================

export function hasPermission(user, permission) {
  if (!user) return false;

  // Global wildcard permission grants all access
  if (user.permissions.includes('*')) {
    return true;
  }

  // Check if permission is in user's permission array
  return user.permissions.includes(permission);
}

// ============================================
// CHECK IF USER HAS ANY PERMISSION
// ============================================

export function hasAnyPermission(user, permissions) {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;

  return permissions.some((perm) => user.permissions.includes(perm));
}

// ============================================
// CHECK IF USER HAS ALL PERMISSIONS
// ============================================

export function hasAllPermissions(user, permissions) {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;

  return permissions.every((perm) => user.permissions.includes(perm));
}

// ============================================
// CHECK IF USER HAS ROLE
// ============================================

export function hasRole(user, role) {
  if (!user) return false;
  return user.role === role;
}

// ============================================
// CHECK IF USER HAS ANY ROLE
// ============================================

export function hasAnyRole(user, roles) {
  if (!user) return false;
  return roles.includes(user.role);
}

// ============================================
// CHECK IF USER CAN ACCESS STORE
// ============================================

export function canAccessStore(user, storeId) {
  if (!user) return false;
  if (canAccessAllStoresGlobally(user)) return true;

  // Check if store is assigned
  return user.assigned_stores.includes(storeId);
}

// ============================================
// CHECK IF USER CAN ACCESS MULTIPLE STORES
// ============================================

export function canAccessAnyStore(user, storeIds) {
  if (!user) return false;
  if (canAccessAllStoresGlobally(user)) return true;

  return storeIds.some((storeId) => user.assigned_stores.includes(storeId));
}

export function canAccessAllStores(user, storeIds) {
  if (!user) return false;
  if (canAccessAllStoresGlobally(user)) return true;

  return storeIds.every((storeId) => user.assigned_stores.includes(storeId));
}

// ============================================
// GET USER'S ACCESSIBLE STORES
// ============================================

export function getUserStores(user) {
  if (!user) return [];
  if (canAccessAllStoresGlobally(user)) return ['all']; // Indicate access to all

  return user.assigned_stores || [];
}

// ============================================
// BUILD STORE FILTER CLAUSE FOR QUERIES
// ============================================

export function getStoreFilterClause(user, tableAlias = '') {
  if (!user) return '1 = 0'; // Deny access

  if (canAccessAllStoresGlobally(user)) {
    return '1 = 1'; // Allow all
  }

  const prefix = tableAlias ? `${tableAlias}.` : '';
  const storeIds = user.assigned_stores;

  if (storeIds.length === 0) {
    return '1 = 0'; // User has no stores assigned
  }

  // Return SQL clause for store filtering
  return `${prefix}store_id = ANY(ARRAY[${storeIds.join(',')}])`;
}

function canAccessAllStoresGlobally(user) {
  const assignedStores = (user?.assigned_stores || []).map(Number).filter(Number.isFinite);
  return user?.role === 'super_admin' && assignedStores.length === 0 && !user?.is_employee;
}

// ============================================
// VALIDATION: ENSURE USER EXISTS & HAS PERMISSION
// ============================================

export function requirePermission(user, requiredPermission) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!hasPermission(user, requiredPermission)) {
    throw new Error(`Forbidden: Missing permission "${requiredPermission}"`);
  }
}

export function requireAnyPermission(user, requiredPermissions) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!hasAnyPermission(user, requiredPermissions)) {
    throw new Error(
      `Forbidden: Missing one of permissions: ${requiredPermissions.join(', ')}`
    );
  }
}

export function requireAllPermissions(user, requiredPermissions) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!hasAllPermissions(user, requiredPermissions)) {
    throw new Error(
      `Forbidden: Missing permissions: ${requiredPermissions.join(', ')}`
    );
  }
}

export function requireRole(user, requiredRole) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!hasRole(user, requiredRole)) {
    throw new Error(`Forbidden: Requires role "${requiredRole}"`);
  }
}

export function requireAnyRole(user, requiredRoles) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!hasAnyRole(user, requiredRoles)) {
    throw new Error(`Forbidden: Requires one of roles: ${requiredRoles.join(', ')}`);
  }
}

export function requireStore(user, storeId) {
  if (!user) {
    throw new Error('Unauthorized: No user');
  }

  if (!canAccessStore(user, storeId)) {
    throw new Error(`Forbidden: Cannot access store ${storeId}`);
  }
}

// ============================================
// USAGE EXAMPLE IN API ROUTES
// ============================================

/*
import { NextResponse } from 'next/server';
import { getCurrentUser, requirePermission } from '@/lib/request-context';

export async function POST(request) {
  try {
    // Get current user from request
    const user = getCurrentUser(request);

    // Check permission
    try {
      requirePermission(user, 'users:create');
    } catch (err) {
      return NextResponse.json(
        { error: err.message },
        { status: 403 }
      );
    }

    // Continue with API logic
    const body = await request.json();
    // ... create user ...

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
*/

export default {
  getCurrentUser,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRole,
  hasAnyRole,
  canAccessStore,
  canAccessAnyStore,
  canAccessAllStores,
  getUserStores,
  getStoreFilterClause,
  requirePermission,
  requireRole,
  requireStore,
};
