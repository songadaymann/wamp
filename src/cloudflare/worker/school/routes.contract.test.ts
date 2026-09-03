import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
const store = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
const schoolAdmin = readFileSync(new URL('../../../school-admin.ts', import.meta.url), 'utf8');

describe('school student access toggle', () => {
  it('lets teachers enable a previously disabled student', () => {
    expect(routes).toContain('/enable$');
    expect(routes).toContain('enableSchoolStudent');
    expect(store).toContain('export async function enableSchoolStudent');
    expect(store).toContain('setSchoolStudentDisabled');
    expect(schoolAdmin).toContain("role', 'switch'");
    expect(schoolAdmin).toContain("disabled ? 'disable' : 'enable'");
    expect(schoolAdmin).toContain('Enable');
  });
});
