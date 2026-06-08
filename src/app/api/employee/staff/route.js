import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getClient, query } from '@/lib/db';
import { ensureEmployeesSchema } from '@/lib/employeesSchema';
import { ensureUsersTable, normalizePhone } from '@/lib/userAuth';
import { validatePhoneNumber } from '@/lib/phoneValidator';
import { requireAuth, requirePermission, requireStore } from '@/lib/api-protection';

// FIXED: Properly handle date strings without timezone corruption
function toDate(value) {
  if (!value) return null;
  
  // If it's already a YYYY-MM-DD string, validate and return as-is
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return null;
    return value; // Return the original string
  }
  
  // For other formats, parse and convert to YYYY-MM-DD
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  
  // Use UTC to avoid timezone issues
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toString(value) {
  return String(value ?? '').trim();
}

function normalizePermissions(input) {
  if (Array.isArray(input)) return input.filter(Boolean);
  if (typeof input === 'string') {
    return input.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeSystemRole(roleName, userType) {
  const value = String(roleName || userType || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (value === 'super_admin' || value === 'superadmin') return 'super_admin';
  if (value === 'admin' || value === 'administrator') return 'admin';
  if (value === 'manager' || value === 'store_manager') return 'manager';
  return 'user';
}

function normalizeStoreIds(input) {
  if (Array.isArray(input)) return input.map(Number).filter(Number.isFinite);
  if (typeof input === 'string') {
    return input.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
  }
  const single = Number(input);
  return Number.isFinite(single) ? [single] : [];
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function duplicateMessageFromPgError(err) {
  const constraint = String(err?.constraint || '').toLowerCase();
  const detail = String(err?.detail || '').toLowerCase();

  if (constraint.includes('username') || detail.includes('(username)=')) {
    return 'Employee username already exists';
  }
  if (constraint.includes('email') || detail.includes('(email)=') || detail.includes('(email_address)=')) {
    return 'Employee email already exists';
  }
  if (
    constraint.includes('phone') ||
    constraint.includes('mobile') ||
    detail.includes('(phone)=') ||
    detail.includes('(mobile_number)=')
  ) {
    return 'Employee mobile number already exists';
  }

  return 'Employee username, email, or mobile already exists';
}

function validateEmployeeInput({
  username,
  firstName,
  password,
  confirmPassword,
  mobileNumber,
  emailAddress,
  roleId,
  roleName,
  permissions,
  isCreate = true,
}) {
  if (!username) return 'Username is required';
  if (!firstName) return 'First name is required';
  if (!mobileNumber) return 'Mobile number is required';
  if (!/^\d{10}$/.test(mobileNumber)) return 'Mobile number must be exactly 10 digits';
  if (!emailAddress) return 'Email address is required';
  if (!isValidEmail(emailAddress)) return 'Enter a valid email address';
  if (!roleId && !roleName) return 'Role is required';
  if (!Array.isArray(permissions) || permissions.length === 0) return 'Select at least one permission';
  if (isCreate && !password) return 'Password is required';
  if (password && password !== confirmPassword) return 'Passwords do not match';
  return '';
}

function mapEmployeeRow(row) {
  return {
    id: row.id,
    username: row.username,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    employeeCode: row.employee_code || '',
    role: row.role_name || '',
    department: row.department_name || '',
    employeeType: row.employment_type || '',
    contractorName: row.contractor_name || '',
    mobileNumber: row.mobile_number || '',
    emailAddress: row.email_address || '',
    employmentStatus: row.employment_status || 'Active',
    gender: row.gender || '',
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    regionStore: row.assigned_store_ids || row.region_store || '',
    warehouse: row.warehouse || '',
    userType: row.user_type || '',
    dateOfBirth: row.date_of_birth || null,
    dateOfJoining: row.date_of_joining || null,
    dateOfLeaving: row.date_of_leaving || null,
    customerName: row.customer_name || '',
    address: row.address || '',
    discountLimitType: row.discount_limit_type || '',
    discountLimitValue: row.discount_limit_value || null,
    maximumDiscountAmount: row.maximum_discount_amount || null,
    createCustomerSameDetails: row.create_customer_same_details || false,
    createdAt: row.created_at,
  };
}

export async function GET(request) {
  try {
    await ensureEmployeesSchema();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_USERS', 'VIEW_USERS');
    if (permissionCheck.error) return permissionCheck.error;

    const params = [];
    const whereClauses = [];
    if (auth.user.role !== 'super_admin') {
      const assignedStores = (auth.user.assigned_stores || []).map(Number).filter(Number.isFinite);
      if (!assignedStores.length) return NextResponse.json([]);
      params.push(assignedStores);
      whereClauses.push(`EXISTS (
        SELECT 1 FROM user_stores us
        WHERE us.user_id = e.user_id
          AND us.is_active = TRUE
          AND us.store_id = ANY($${params.length}::int[])
      )`);
    }

    const res = await query(
      `SELECT e.id,
              e.username,
              e.first_name,
              e.last_name,
              e.gender,
              e.mobile_number,
              e.email_address,
              e.role_name,
              e.permissions,
              e.region_store,
              e.warehouse,
              (SELECT string_agg(us.store_id::text, ',' ORDER BY us.store_id)
               FROM user_stores us
               WHERE us.user_id = e.user_id AND us.is_active = TRUE) AS assigned_store_ids,
              e.department_name,
              e.customer_name,
              e.user_type,
              e.date_of_birth,
              e.date_of_joining,
              e.date_of_leaving,
              e.employee_code,
              e.create_customer_same_details,
              e.discount_limit_type,
              e.discount_limit_value,
              e.maximum_discount_amount,
              e.address,
              e.employment_type,
              e.employment_status,
              e.contractor_name,
              e.created_at
       FROM employees e
       ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
       ORDER BY e.created_at DESC, e.id DESC`,
      params
    );

    return NextResponse.json(res.rows.map(mapEmployeeRow));
  } catch (err) {
    console.error('[employee staff GET]', err.message);
    return NextResponse.json([]);
  }
}

export async function POST(request) {
  const client = await getClient();
  try {
    await ensureEmployeesSchema();
    await ensureUsersTable();
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const permissionCheck = requirePermission(auth.user, 'MANAGE_USERS');
    if (permissionCheck.error) return permissionCheck.error;

    const body = await request.json();
    const username = toString(body.username);
    const firstName = toString(body.first_name || body.firstName);
    const lastName = toString(body.last_name || body.lastName);
    const gender = toString(body.gender);
    const password = toString(body.password);
    const confirmPassword = toString(body.confirm_password || body.confirmPassword);
    const mobileNumber = normalizePhone(body.mobile_number || body.mobileNumber || '');
    const emailAddress = toString(body.email_address || body.emailAddress).toLowerCase();
    const roleId = body.role_id ?? body.roleId ?? null;
    const roleName = toString(body.role_name || body.roleName);
    const regionStore = Array.isArray(body.region_store || body.regionStore)
      ? (body.region_store || body.regionStore).map((item) => String(item).trim()).filter(Boolean).join(',')
      : toString(body.region_store || body.regionStore);
    const warehouse = Array.isArray(body.warehouse)
      ? body.warehouse.map((item) => String(item).trim()).filter(Boolean).join(',')
      : toString(body.warehouse);
    const assignedStores = normalizeStoreIds(
      body.assigned_stores || body.assignedStores || body.store_ids || body.storeIds || body.store_id || body.storeId || regionStore
    );
    const permissions = normalizePermissions(body.permissions);
    const departmentId = body.department_id ?? body.departmentId ?? null;
    const departmentName = toString(body.department_name || body.departmentName);
    const customerName = toString(body.customer_name || body.customerName);
    const userType = toString(body.user_type || body.userType);
    const systemRole = normalizeSystemRole(roleName, body.system_role || body.systemRole || body.user_role || body.userRole || userType);
    const dateOfBirth = toDate(body.date_of_birth || body.dateOfBirth);
    const dateOfJoining = toDate(body.date_of_joining || body.dateOfJoining);
    const dateOfLeaving = toDate(body.date_of_leaving || body.dateOfLeaving);
    const employeeCode = toString(body.employee_code || body.employeeCode);
    const createCustomerSameDetails = Boolean(body.create_customer_same_details || body.createCustomerSameDetails);
    const discountLimitType = toString(body.discount_limit_type || body.discountLimitType);
    const discountLimitValue = body.discount_limit_value ?? body.discountLimitValue ?? null;
    const maximumDiscountAmount = body.maximum_discount_amount ?? body.maximumDiscountAmount ?? null;
    const address = toString(body.address);
    const employmentType = toString(body.employment_type || body.employmentType);
    const employmentStatus = toString(body.employment_status || body.employmentStatus) || 'Active';
    const contractorName = toString(body.contractor_name || body.contractorName);

    if (systemRole === 'super_admin' && auth.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Only Super Admin can create Super Admin users' }, { status: 403 });
    }

    for (const storeId of assignedStores) {
      const storeCheck = requireStore(auth.user, storeId);
      if (storeCheck.error) return storeCheck.error;
    }

    const validationError = validateEmployeeInput({
      username,
      firstName,
      password,
      confirmPassword,
      mobileNumber,
      emailAddress,
      roleId,
      roleName,
      permissions,
      isCreate: true,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (mobileNumber) {
      const phoneValidation = validatePhoneNumber(mobileNumber);
      if (!phoneValidation.isValid) {
        return NextResponse.json({ error: phoneValidation.error }, { status: 400 });
      }
    }

    const duplicateRes = await client.query(
      `SELECT
         EXISTS(SELECT 1 FROM employees WHERE LOWER(username) = LOWER($1)) AS username_exists,
         EXISTS(SELECT 1 FROM employees WHERE LOWER(email_address) = LOWER($2)) AS employee_email_exists,
         EXISTS(SELECT 1 FROM employees WHERE mobile_number = $3) AS employee_mobile_exists`,
      [username, emailAddress, mobileNumber]
    );

    const duplicates = duplicateRes.rows[0] || {};
    if (duplicates.username_exists) {
      return NextResponse.json({ error: 'Employee username already exists' }, { status: 409 });
    }
    if (duplicates.employee_email_exists) {
      return NextResponse.json({ error: 'Employee email already exists' }, { status: 409 });
    }
    if (duplicates.employee_mobile_exists) {
      return NextResponse.json({ error: 'Employee mobile number already exists' }, { status: 409 });
    }

    const existingUsersRes = await client.query(
      `SELECT id, email, phone
       FROM users
       WHERE LOWER(email) = LOWER($1)
          OR phone = $2`,
      [emailAddress, mobileNumber]
    );

    const existingUsers = existingUsersRes.rows || [];
    const emailUser = existingUsers.find((row) => String(row.email || '').toLowerCase() === emailAddress);
    const phoneUser = existingUsers.find((row) => String(row.phone || '') === mobileNumber);

    if (emailUser && phoneUser && Number(emailUser.id) !== Number(phoneUser.id)) {
      return NextResponse.json(
        { error: 'Email and mobile are already mapped to different users' },
        { status: 409 }
      );
    }

    const existingUserId = emailUser?.id || phoneUser?.id || null;
    if (existingUserId) {
      const linkedEmployeeRes = await client.query(
        `SELECT id FROM employees WHERE user_id = $1 LIMIT 1`,
        [existingUserId]
      );

      if (linkedEmployeeRes.rows.length > 0) {
        return NextResponse.json(
          { error: 'An employee is already linked with this email or mobile' },
          { status: 409 }
        );
      }
    }

    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(password, 10);
    const fallbackToken = randomUUID();

    let userId = existingUserId;
    if (userId) {
      const userUpdateRes = await client.query(
        `UPDATE users
         SET name = $2,
             email = $3,
             phone = $4,
             password_hash = $5,
             role = $6,
             is_active = TRUE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [
          userId,
          [firstName, lastName].filter(Boolean).join(' ').trim() || username,
          emailAddress || `${username || 'employee'}-${fallbackToken}@example.com`,
          mobileNumber || `emp-${fallbackToken.slice(0, 12)}`,
          passwordHash,
          systemRole,
        ]
      );
      userId = userUpdateRes.rows[0]?.id;
    } else {
      const userRes = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
         RETURNING id`,
        [
          [firstName, lastName].filter(Boolean).join(' ').trim() || username,
          emailAddress || `${username || 'employee'}-${fallbackToken}@example.com`,
          mobileNumber || `emp-${fallbackToken.slice(0, 12)}`,
          passwordHash,
          systemRole,
        ]
      );
      userId = userRes.rows[0]?.id;
    }

    for (const storeId of assignedStores) {
      await client.query(
        `INSERT INTO user_stores (user_id, store_id, is_active, created_at, updated_at)
         VALUES ($1, $2, TRUE, NOW(), NOW())
         ON CONFLICT (user_id, store_id) DO UPDATE
         SET is_active = TRUE, updated_at = NOW()`,
        [userId, storeId]
      );
    }

    const employeeRes = await client.query(
      `INSERT INTO employees (
        user_id, username, first_name, last_name, gender, mobile_number, email_address,
        role_id, role_name, permissions, region_store, warehouse, department_id, department_name,
        customer_name, user_type, date_of_birth, date_of_joining, date_of_leaving, employee_code,
        create_customer_same_details, discount_limit_type, discount_limit_value, maximum_discount_amount,
        address, employment_type, employment_status, contractor_name, meta, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10::jsonb, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27, $28, $29::jsonb, NOW(), NOW()
      )
      RETURNING *`,
      [
        userId,
        username,
        firstName,
        lastName || null,
        gender || null,
        mobileNumber || null,
        emailAddress || null,
        roleId || null,
        roleName || null,
        JSON.stringify(permissions),
        regionStore || null,
        warehouse || null,
        departmentId || null,
        departmentName || null,
        customerName || null,
        userType || null,
        dateOfBirth,
        dateOfJoining,
        dateOfLeaving,
        employeeCode || null,
        createCustomerSameDetails,
        discountLimitType || null,
        discountLimitValue || null,
        maximumDiscountAmount || null,
        address || null,
        employmentType || null,
        employmentStatus,
        contractorName || null,
        JSON.stringify(body),
      ]
    );

    await client.query('COMMIT');
    return NextResponse.json(mapEmployeeRow(employeeRes.rows[0]), { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if (err.code === '23505') {
      return NextResponse.json({ error: duplicateMessageFromPgError(err) }, { status: 409 });
    }

    console.error('[employee staff POST]', err.message);
    return NextResponse.json({ error: 'Failed to create employee' }, { status: 500 });
  } finally {
    client.release();
  }
}
