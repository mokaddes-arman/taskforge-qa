import path from 'node:path';
import { config } from 'dotenv';

// Load the application credentials once, relative to the project root.
config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

export interface Credentials {
  email: string;
  password: string;
}

function normalisePath(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

export const env = {
  baseURL: (process.env.BASE_URL ?? 'https://mytaskforge.net/').trim(),
  workspacePath: normalisePath(
    (process.env.WORKSPACE_PATH ?? '/abdul-s-workspace').trim(),
  ),
  ownerEmail: (process.env.owner_email ?? '').trim(),
  ownerPassword: (process.env.owner_password ?? '').trim(),
} as const;

export const AUTH_DIR = path.resolve(process.cwd(), 'playwright', '.auth');
export const STORAGE_STATE = path.join(AUTH_DIR, 'user.json');

/**
 * Returns the owner credentials and fails with a helpful message when `.env`
 * is incomplete. The password is never included in error output.
 */
export function ownerCredentials(): Credentials {
  if (!env.ownerEmail || !env.ownerPassword) {
    throw new Error(
      'Missing owner_email and/or owner_password. Add both to .env at the project root.',
    );
  }

  return {
    email: env.ownerEmail,
    password: env.ownerPassword,
  };
}

/** Workspace roles the RBAC suite exercises (besides the owner above). */
export type WorkspaceRole = 'admin' | 'manager' | 'employee';

export const SUPER_ADMIN_STATE = path.join(AUTH_DIR, 'super-admin.json');
export const ROLE_STATES: Record<WorkspaceRole, string> = {
  admin: path.join(AUTH_DIR, 'role-admin.json'),
  manager: path.join(AUTH_DIR, 'role-manager.json'),
  employee: path.join(AUTH_DIR, 'role-employee.json'),
};

/** Platform (super) admin credentials; the password is never echoed. */
export function superAdminCredentials(): Credentials {
  const email = (process.env.super_admin ?? '').trim();
  const password = (process.env.super_admin_password ?? '').trim();
  if (!email || !password) {
    throw new Error('Missing super_admin and/or super_admin_password. Add both to .env at the project root.');
  }
  return { email, password };
}

/** Email of the QA account that holds `role` in the workspace (qa_<role>_email). */
export function roleEmail(role: WorkspaceRole): string {
  const email = (process.env[`qa_${role}_email`] ?? '').trim();
  if (!email) {
    throw new Error(`Missing qa_${role}_email in .env (see scripts/provision-role-accounts.cjs).`);
  }
  return email;
}
