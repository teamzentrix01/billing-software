import { query } from '@/lib/db';
import bcrypt from 'bcryptjs';

const CREATE_USERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

const globalForUsers = globalThis;

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@grocerymart.local';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Super Admin';
const SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || 'super-admin';

export async function ensureUsersTable() {
  if (!globalForUsers._usersTableReadyPromise) {
    globalForUsers._usersTableReadyPromise = (async () => {
      await query(CREATE_USERS_TABLE_SQL);
      await query(`
        CREATE TABLE IF NOT EXISTS stores (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users
          ADD CONSTRAINT users_role_check
          CHECK (role IN ('super_admin', 'admin', 'manager', 'user'));

        CREATE TABLE IF NOT EXISTS user_stores (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, store_id)
        );

        DELETE FROM user_stores a
        USING user_stores b
        WHERE a.id > b.id
          AND a.user_id = b.user_id
          AND a.store_id = b.store_id;

        CREATE UNIQUE INDEX IF NOT EXISTS user_stores_user_id_store_id_unique_idx
          ON user_stores (user_id, store_id);
      `);

      const superAdminEmail = normalizeEmail(SUPER_ADMIN_EMAIL);
      const superAdminPhone = String(SUPER_ADMIN_PHONE).trim();
      const existingSuperAdmin = await query(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [superAdminEmail]
      );

      if (existingSuperAdmin.rows.length > 0 && process.env.SUPER_ADMIN_RESET_ON_START !== 'true') {
        await query(
          `UPDATE users
           SET role = 'super_admin',
               is_active = TRUE,
               updated_at = NOW()
           WHERE email = $1`,
          [superAdminEmail]
        );
        return;
      }

      const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
      await query(
        `INSERT INTO users (name, email, phone, password_hash, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'super_admin', TRUE, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE
         SET role = 'super_admin',
             password_hash = EXCLUDED.password_hash,
             is_active = TRUE,
             updated_at = NOW()`,
        [SUPER_ADMIN_NAME, superAdminEmail, superAdminPhone, passwordHash]
      );
    })().catch((err) => {
      globalForUsers._usersTableReadyPromise = null;
      throw err;
    });
  }

  await globalForUsers._usersTableReadyPromise;
}

export function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone = '') {
  return phone.replace(/\D/g, '');
}
