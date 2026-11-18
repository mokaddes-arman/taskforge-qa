// Unit tests for the reporter's secret masking (QA-018).
// Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from './dashboard-reporter.js';

const SECRET = 'Dummy#Pass"word1';

test('masks a secret in a Playwright step title', () => {
  assert.equal(redactSecrets(`Fill "${SECRET}"`, [SECRET]), 'Fill "***"');
});

test('masks every occurrence, including the JSON-escaped spelling', () => {
  const json = JSON.stringify({ steps: [`Fill "${SECRET}"`, SECRET] });
  const out = redactSecrets(json, [SECRET]);
  assert.ok(!out.includes(SECRET), 'raw secret must be gone');
  assert.ok(!out.includes(JSON.stringify(SECRET).slice(1, -1)), 'escaped secret must be gone');
  assert.equal((out.match(/\*\*\*/g) || []).length, 2);
});

test('leaves text without secrets unchanged', () => {
  const text = 'Navigate to /login\nClick "Log in"';
  assert.equal(redactSecrets(text, [SECRET]), text);
});

test('masks the longest secret first so overlapping values do not leak a suffix', () => {
  assert.equal(redactSecrets('abcdef', ['abcd', 'abcdef']), '***');
});

test('treats null and undefined as empty text', () => {
  assert.equal(redactSecrets(undefined, [SECRET]), '');
  assert.equal(redactSecrets(null, [SECRET]), '');
});

test('reads secret values from password/secret/token/api-key environment variables', () => {
  const previous = process.env.QA_UNIT_TEST_PASSWORD;
  process.env.QA_UNIT_TEST_PASSWORD = 'env-only-secret-value';
  try {
    assert.equal(redactSecrets('value=env-only-secret-value'), 'value=***');
  } finally {
    if (previous === undefined) delete process.env.QA_UNIT_TEST_PASSWORD;
    else process.env.QA_UNIT_TEST_PASSWORD = previous;
  }
});

test('ignores very short environment values to avoid masking ordinary words', () => {
  const previous = process.env.QA_UNIT_TEST_TOKEN;
  process.env.QA_UNIT_TEST_TOKEN = 'ab';
  try {
    assert.equal(redactSecrets('tab label'), 'tab label');
  } finally {
    if (previous === undefined) delete process.env.QA_UNIT_TEST_TOKEN;
    else process.env.QA_UNIT_TEST_TOKEN = previous;
  }
});
