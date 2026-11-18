#!/usr/bin/env node
/**
 * One-off provisioning of QA role accounts (Admin / Manager) for RBAC tests.
 * WRITES TO PRODUCTION: signs up accounts and (step "add") adds them to the
 * workspace. Authorised by the product owner on 2026-11-17. Never part of a test run.
 *
 * Usage: node scripts/provision-role-accounts.cjs signup <role>
 *        node scripts/provision-role-accounts.cjs add <role>
 * Set qa_<role>_email in .env first; the password is generated once and stored as qa_<role>_password.
 * Nothing secret is printed.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const { chromium } = require('@playwright/test');

const ENV = path.resolve(process.cwd(), '.env');
const BASE = (process.env.BASE_URL || 'https://mytaskforge.net/').trim();
const WS = (process.env.WORKSPACE_PATH || '/abdul-s-workspace').trim().replace(/^\/?/, '/');
const ROLES = {
  admin: { name: 'QA Admin', uiRole: 'Admin' },
  manager: { name: 'QA Manager', uiRole: 'Manager' },
};

function ensureCredentials(role) {
  const ek = `qa_${role}_email`, pk = `qa_${role}_password`;
  const email = (process.env[ek] || '').trim();
  if (!email) throw new Error(`Set ${ek} in .env (an inbox you control, e.g. a plus-address) before provisioning.`);
  if (process.env[pk]) return { email, password: process.env[pk].trim() };
  const password = `Qa-${crypto.randomBytes(12).toString('base64url')}9`;
  const text = fs.readFileSync(ENV, 'utf8');
  fs.writeFileSync(ENV, `${text.replace(/\s*$/, '')}\n${pk}="${password}"\n`);
  return { email, password };
}

async function setSecret(locator, value) {
  await locator.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function signup(role) {
  const { email, password } = ensureCredentials(role);
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  const done = page.waitForResponse((r) => r.url().includes('/sign-up/email'), { timeout: 30_000 });
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Full name' }).fill(ROLES[role].name);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await setSecret(page.getByRole('textbox', { name: 'Password', exact: true }), password);
  await setSecret(page.getByRole('textbox', { name: 'Confirm password' }), password);
  await page.getByRole('button', { name: 'Create account' }).click();
  const res = await done;
  const body = await res.json().catch(() => ({}));
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log(`signup ${role}: HTTP ${res.status()} keys=${Object.keys(body.data ?? body)} token=${Boolean((body.data ?? body).token)}`);
  console.log(`  landed on ${new URL(page.url()).pathname}; h1=${JSON.stringify(await page.locator('h1').allInnerTexts())}`);
  await browser.close();
}

async function add(role) {
  const { email } = ensureCredentials(role);
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE, storageState: 'playwright/.auth/user.json' });
  await page.goto(`${WS}/employees`);
  await page.getByRole('button', { name: 'Add employees' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add members' });
  await dialog.getByRole('combobox').first().click();
  await page.keyboard.type(email);
  await page.getByRole('option').filter({ hasText: email }).first().click();
  await page.keyboard.press('Escape').catch(() => {});
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: ROLES[role].uiRole, exact: true }).click();
  const done = page.waitForResponse((r) => r.request().method() !== 'GET' && r.url().includes('/api/v1/workspaces/'), { timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Add member' }).click();
  const res = await done;
  console.log(`add ${role}: ${res.request().method()} ${new URL(res.url()).pathname} HTTP ${res.status()}`);
  await browser.close();
}

const [step, role] = process.argv.slice(2);
if (!ROLES[role] || !['signup', 'add'].includes(step)) { console.error('usage: signup|add admin|manager'); process.exit(2); }
(step === 'signup' ? signup : add)(role).catch((e) => { console.error(String(e.message).split('\n')[0]); process.exit(1); });
