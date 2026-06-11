import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { signAccessToken, signRefreshToken, createTokenPayload } from '@/lib/auth-enhanced';
import { unauthorizedError, validationError } from '@/lib/api-response';
import { query } from '@/lib/db';
import { rateLimiters, rateLimitHeaders } from '@/lib/rate-limiter';
import { getUserIP } from '@/lib/api-protection';
import { ensureUsersTable } from '@/lib/userAuth';
import { ensureRolesSchema } from '@/lib/rolesSchema';
import { ensureSessionsSchema } from '@/lib/sessionsSchema';
import { ensureAuditLogsSchema } from '@/lib/auditLogsSchema';
import { applyEffectivePasswordChange, ensurePasswordChangeRequestsTable } from '@/lib/passwordChangeRequests';

function getDefaultRoute(role) {
  if (role === 'super_admin') return '/home/master-dashboard';
  if (role === 'user') return '/sales/pos';
  return '/home';
}

const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

export async function POST(request) {
  try {
    await ensureUsersTable();
    await ensureRolesSchema();
    await ensureSessionsSchema();
    await ensureAuditLogsSchema();
    await ensurePasswordChangeRequestsTable();

    debugLog('[LOGIN] Request received');
    
    // ============================================
    // STEP 0: PARSE REQUEST BODY
    // ============================================
    
    let body;
    try {
      body = await request.json();
      debugLog('[LOGIN] Body parsed:', { 
        email: body.email, 
        password: body.password ? '***' : 'undefined',
        bodyKeys: Object.keys(body)
      });
    } catch (err) {
      console.error('[LOGIN] JSON parse error:', err.message);
      return validationError({
        field: 'body',
        message: 'Invalid JSON in request body',
      });
    }

    const { email, password } = body;

    // ============================================
    // STEP 0.5: RATE LIMITING
    // ============================================

    const userIP = getUserIP(request);
    const limiter = rateLimiters.login.check(userIP);

    if (!limiter.allowed) {
      console.warn('[LOGIN] Rate limit exceeded from IP:', userIP);
      const response = NextResponse.json(
        {
          success: false,
          message: `Too many login attempts. Please try again after ${limiter.resetTime.toLocaleTimeString()}`,
        },
        { status: 429 }
      );
      Object.entries(rateLimitHeaders(limiter)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }

    // ============================================
    // STEP 1: VALIDATE INPUT
    // ============================================

    debugLog('[LOGIN] Validating input:', { 
      hasEmail: !!email, 
      hasPassword: !!password,
      emailType: typeof email,
      passwordType: typeof password
    });

    if (!email || !password) {
      console.error('[LOGIN] Validation failed - missing fields', { 
        email: email || 'MISSING', 
        password: password ? 'PROVIDED' : 'MISSING'
      });
      return validationError({
        field: 'email/password',
        message: 'Email and password are required',
      });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      console.error('[LOGIN] Invalid field types');
      return validationError({
        field: 'email/password',
        message: 'Email and password must be strings',
      });
    }

    // ============================================
    // STEP 2: FIND USER IN users TABLE
    // ============================================

    debugLog('[LOGIN] Searching for user:', { email: email.toLowerCase() });

    let userResult;
    try {
      userResult = await query(
        `SELECT id, name, email, phone, password_hash, role, is_active, created_at, updated_at
         FROM users
         WHERE LOWER(email) = LOWER($1) AND is_active = TRUE`,
        [email]
      );
      debugLog('[LOGIN] User query result:', { 
        found: userResult.rows.length > 0,
        rowCount: userResult.rows.length
      });
    } catch (err) {
      console.error('[LOGIN] Database query error:', err.message);
      return NextResponse.json(
        { error: 'Unable to authenticate' },
        { status: 500 }
      );
    }

    if (userResult.rows.length === 0) {
      console.warn('[LOGIN] User not found:', email);
      return unauthorizedError('Invalid email or password');
    }

    const user = userResult.rows[0];
    await applyEffectivePasswordChange(user.id);

    const freshPasswordResult = await query(
      `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
      [user.id]
    );
    user.password_hash = freshPasswordResult.rows[0]?.password_hash || user.password_hash;
    debugLog('[LOGIN] User found:', { 
      id: user.id, 
      email: user.email,
      role: user.role,
      is_active: user.is_active,
    });

    // ============================================
    // STEP 4: VERIFY PASSWORD
    // ============================================

    debugLog('[LOGIN] Verifying password');

    let isPasswordValid;
    try {
      isPasswordValid = await bcrypt.compare(password, user.password_hash);
      debugLog('[LOGIN] Password verification result:', { 
        isValid: isPasswordValid,
        hashExists: !!user.password_hash
      });
    } catch (err) {
      console.error('[LOGIN] Bcrypt comparison error:', err.message);
      return NextResponse.json(
        { error: 'Unable to authenticate' },
        { status: 500 }
      );
    }

    if (!isPasswordValid) {
      console.warn('[LOGIN] Invalid password for:', email);

      return unauthorizedError('Invalid email or password');
    }

    // ============================================
    // STEP 5: RESET FAILED ATTEMPTS & UPDATE LOGIN TIME
    // ============================================

    debugLog('[LOGIN] Updating last login timestamp');

    try {
      await query(
        `UPDATE users 
         SET updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
    } catch (err) {
      console.error('[LOGIN] Failed to update login timestamp:', err.message);
    }

    // ============================================
    // STEP 6: GET USER'S PERMISSIONS
    // ============================================

    debugLog('[LOGIN] Fetching employee permissions (roles are informational only)');
    let permissions = [];
    let hasEmployeeProfile = false;

    try {
      const employeePermResult = await query(
        `SELECT permissions
         FROM employees
         WHERE user_id = $1
            OR LOWER(email_address) = LOWER($2)
            OR LOWER(username) = LOWER($3)
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [user.id, user.email || '', user.name || '']
      );

      if (employeePermResult.rows.length > 0) {
        hasEmployeeProfile = true;
        permissions = Array.isArray(employeePermResult.rows[0]?.permissions)
          ? employeePermResult.rows[0].permissions
          : [];
      }
    } catch (err) {
      console.warn('[LOGIN] Failed to fetch employee permissions:', err.message);
    }

    // Super admins without an employee record get full wildcard access
    if (!hasEmployeeProfile && user.role === 'super_admin' && permissions.length === 0) {
      permissions = ['*'];
    }

    // ============================================
    // STEP 7: GET USER'S ASSIGNED STORES
    // ============================================

    debugLog('[LOGIN] Fetching assigned stores');

    let storesResult = { rows: [] };
    try {
      storesResult = await query(
        `SELECT store_id FROM user_stores 
         WHERE user_id = $1 AND is_active = TRUE
         ORDER BY store_id`,
        [user.id]
      );
      debugLog('[LOGIN] Stores found:', { 
        count: storesResult.rows.length,
        stores: storesResult.rows.map(s => s.store_id)
      });
    } catch (err) {
      console.warn('[LOGIN] user_stores table does not exist or query failed:', err.message);
      // This is OK - user_stores table is optional
    }

    const assignedStores = storesResult.rows.map((s) => s.store_id);
    const effectiveRole =
      hasEmployeeProfile && user.role === 'super_admin'
        ? 'admin'
        : user.role || 'user';

    // ============================================
    // STEP 8: CREATE TOKEN PAYLOAD
    // ============================================

    debugLog('[LOGIN] Creating token payload');

    const tokenPayload = createTokenPayload({
      id: user.id,
      email: user.email,
      name: user.name || user.email,
      role: effectiveRole,
      permissions,
      assigned_stores: assignedStores,
    });

    debugLog('[LOGIN] Token payload created:', { 
      sub: tokenPayload.sub,
      role: tokenPayload.role,
      permissionCount: tokenPayload.permissions.length
    });

    // ============================================
    // STEP 9: SIGN ACCESS & REFRESH TOKENS
    // ============================================

    debugLog('[LOGIN] Signing tokens');

    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    debugLog('[LOGIN] Tokens signed successfully');

    // ============================================
    // STEP 10: HASH TOKENS FOR SESSION STORAGE
    // ============================================

    const accessTokenHash = crypto
      .createHash('sha256')
      .update(accessToken)
      .digest('hex');

    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    // ============================================
    // STEP 11: STORE SESSION IN DATABASE
    // ============================================

    debugLog('[LOGIN] Storing session');

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('cf-connecting-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    try {
      await query(
        `INSERT INTO sessions 
         (user_id, access_token_hash, refresh_token_hash, ip_address, user_agent, expires_at, refresh_expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days', NOW() + INTERVAL '30 days')`,
        [user.id, accessTokenHash, refreshTokenHash, ipAddress, userAgent]
      );
      debugLog('[LOGIN] Session stored successfully');
    } catch (err) {
      console.error('[LOGIN] Failed to store session:', err.message);
    }

    // ============================================
    // STEP 12: LOG LOGIN ATTEMPT IN AUDIT
    // ============================================

    debugLog('[LOGIN] Logging audit entry');

    try {
      await query(
        `INSERT INTO audit_logs 
         (user_id, action, resource_type, ip_address, user_agent, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, 'LOGIN', 'AUTH', ipAddress, userAgent, 'success']
      );
    } catch (err) {
      console.error('[LOGIN] Failed to log audit entry:', err.message);
    }

    // ============================================
    // STEP 13: REDIRECT TO HOME
    // ============================================

    debugLog('[LOGIN] Login successful for:', email);
    const defaultRoute = getDefaultRoute(effectiveRole);
    debugLog('[LOGIN] Redirecting to', defaultRoute);

    // Create redirect response
    const redirectUrl = new URL(defaultRoute, request.url);
    const response = NextResponse.redirect(redirectUrl, { status: 302 });

    // ============================================
    // STEP 14: SET COOKIES ON REDIRECT
    // ============================================

    response.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    response.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    });

    debugLog('[LOGIN] Cookies set, redirecting');
    
    // Reset rate limit on successful login
    rateLimiters.login.reset(userIP);

    return response;

  } catch (err) {
    console.error('[LOGIN] Unhandled error:', err);
    console.error('[LOGIN] Error message:', err.message);
    console.error('[LOGIN] Error stack:', err.stack);

    // Log failed attempt
    try {
      const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';

      await query(
        `INSERT INTO audit_logs 
         (action, resource_type, ip_address, user_agent, status, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['LOGIN_FAILED', 'AUTH', ipAddress, userAgent, 'error', err.message]
      );
    } catch (auditErr) {
      console.error('[LOGIN] Failed to log error to audit:', auditErr.message);
    }

    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Login failed'
      },
      { status: 500 }
    );
  }
}

/**
 * TESTING THIS ENDPOINT
 * =====================
 * 
 * POST /api/auth/login
 * Content-Type: application/json
 * 
 * {
 *   "email": "admin@buyzaarsync.com",
 *   "password": "admin@123"
 * }
 * 
 * Expected: 302 Redirect to /home with access_token & refresh_token cookies
 */

