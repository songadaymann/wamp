import { apiRequest } from './api/request';
import { getApiBaseUrl } from './api/baseUrl';
import type { MagicLinkRequestResponse } from './auth/model';
import type {
  SchoolStudentCreateResponse,
  SchoolStudentDisableResponse,
  SchoolStudentEnableResponse,
  SchoolStudentRecord,
  SchoolStudentResetPasswordResponse,
  SchoolTeacherStudentListResponse,
} from './school/model';

interface LocalRosterEntry {
  localName: string;
}

interface LocalRosterBackupRow {
  studentId?: string;
  username: string;
  localName: string;
}

const params = new URL(window.location.href).searchParams;
const classroomSlug = params.get('classroom')?.trim() ?? '';
const localRosterKey = `ep_school_roster_${classroomSlug}_v1`;

const classroomSummary = document.getElementById('classroom-summary');
const studentLink = document.getElementById('student-link') as HTMLAnchorElement | null;
const signinPanel = document.getElementById('signin-panel');
const teacherEmailInput = document.getElementById('teacher-email-input') as HTMLInputElement | null;
const requestLinkButton = document.getElementById('btn-request-link') as HTMLButtonElement | null;
const debugLink = document.getElementById('debug-link') as HTMLAnchorElement | null;
const rosterPanel = document.getElementById('roster-panel');
const rosterStatus = document.getElementById('roster-status');
const studentsBody = document.getElementById('students-body');
const localNameInput = document.getElementById('local-name-input') as HTMLInputElement | null;
const usernameInput = document.getElementById('student-username-input') as HTMLInputElement | null;
const createStudentButton = document.getElementById('btn-create-student') as HTMLButtonElement | null;
const credentialPanel = document.getElementById('credential-panel');
const credentialText = document.getElementById('credential-text');
const copyCredentialButton = document.getElementById('btn-copy-credential') as HTMLButtonElement | null;
const exportJsonButton = document.getElementById('btn-export-json') as HTMLButtonElement | null;
const exportCsvButton = document.getElementById('btn-export-csv') as HTMLButtonElement | null;
const importButton = document.getElementById('btn-import') as HTMLButtonElement | null;
const importInput = document.getElementById('import-input') as HTMLInputElement | null;
const pageStatus = document.getElementById('page-status');

let students: SchoolStudentRecord[] = [];
let localRoster = loadLocalRoster();
let lastCredentialCard = '';
let busy = false;

requestLinkButton?.addEventListener('click', () => {
  void requestTeacherLink();
});
teacherEmailInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void requestTeacherLink();
  }
});
createStudentButton?.addEventListener('click', () => {
  void createStudent();
});
usernameInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void createStudent();
  }
});
copyCredentialButton?.addEventListener('click', () => {
  void copyLastCredential();
});
exportJsonButton?.addEventListener('click', exportJsonBackup);
exportCsvButton?.addEventListener('click', exportCsvBackup);
importButton?.addEventListener('click', () => importInput?.click());
importInput?.addEventListener('change', () => {
  void importBackup();
});

void initialize();

async function initialize(): Promise<void> {
  if (!classroomSlug) {
    setPageStatus('Missing classroom link.', true);
    return;
  }

  await loadTeacherRoster();
}

async function requestTeacherLink(): Promise<void> {
  const email = teacherEmailInput?.value.trim() ?? '';
  if (!email) {
    setPageStatus('Enter the teacher email first.', true);
    return;
  }

  setBusy(true);
  setPageStatus('Sending sign-in link...', false);
  hideDebugLink();

  try {
    const response = await apiRequest<MagicLinkRequestResponse>('/api/auth/request-link', {
      method: 'POST',
      body: JSON.stringify({
        email,
        returnTo: buildReturnToUrl(),
      }),
    });
    if (response.debugMagicLink) {
      showDebugLink(response.debugMagicLink);
      setPageStatus('Debug sign-in link generated below.', false);
    } else {
      setPageStatus('Check your email for the sign-in link.', false);
    }
  } catch (error) {
    setPageStatus(getErrorMessage(error, 'Failed to request sign-in link.'), true);
  } finally {
    setBusy(false);
  }
}

async function loadTeacherRoster(): Promise<void> {
  setBusy(true);
  setRosterStatus('Loading roster...', false);

  try {
    const payload = await apiRequest<SchoolTeacherStudentListResponse>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}/teacher/students`,
    );
    students = payload.students;
    if (classroomSummary) {
      classroomSummary.textContent = `${payload.classroom.displayName} - ${payload.classroom.teacherEmail}`;
    }
    if (studentLink) {
      studentLink.href = payload.classroom.studentLoginUrl;
      studentLink.textContent = 'Student login link';
    }
    signinPanel?.classList.add('hidden');
    rosterPanel?.classList.remove('hidden');
    setRosterStatus(`${students.length} student account${students.length === 1 ? '' : 's'}.`, false);
    setPageStatus('', false);
    renderStudents();
    stripAuthQuery();
  } catch (error) {
    signinPanel?.classList.remove('hidden');
    rosterPanel?.classList.add('hidden');
    setPageStatus(getErrorMessage(error, 'Sign in with the registered teacher email.'), true);
  } finally {
    setBusy(false);
  }
}

async function createStudent(): Promise<void> {
  const username = usernameInput?.value.trim() ?? '';
  const localName = localNameInput?.value.trim() ?? '';
  if (!username) {
    setRosterStatus('Enter a student username.', true);
    return;
  }

  setBusy(true);
  setRosterStatus(`Creating ${username}...`, false);
  hideCredential();

  try {
    const response = await apiRequest<SchoolStudentCreateResponse>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}/teacher/students`,
      {
        method: 'POST',
        body: JSON.stringify({ username }),
      },
    );
    students = [...students, response.student].sort(compareStudents);
    if (localName) {
      localRoster[response.student.id] = { localName };
      saveLocalRoster();
    }
    if (usernameInput) {
      usernameInput.value = '';
    }
    if (localNameInput) {
      localNameInput.value = '';
    }
    showCredential(response.student, response.temporaryPassword);
    setRosterStatus(`Created ${response.student.username}. Temporary password is shown once.`, false);
    renderStudents();
  } catch (error) {
    setRosterStatus(getErrorMessage(error, 'Failed to create student.'), true);
  } finally {
    setBusy(false);
  }
}

async function resetPassword(student: SchoolStudentRecord): Promise<void> {
  setBusy(true);
  setRosterStatus(`Resetting ${student.username}...`, false);
  hideCredential();

  try {
    const response = await apiRequest<SchoolStudentResetPasswordResponse>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}/teacher/students/${encodeURIComponent(student.id)}/reset-password`,
      { method: 'POST' },
    );
    students = students.map((item) => (item.id === response.student.id ? response.student : item));
    showCredential(response.student, response.temporaryPassword);
    setRosterStatus(`Reset ${response.student.username}. Temporary password is shown once.`, false);
    renderStudents();
  } catch (error) {
    setRosterStatus(getErrorMessage(error, 'Failed to reset password.'), true);
  } finally {
    setBusy(false);
  }
}

async function setStudentDisabled(student: SchoolStudentRecord, disabled: boolean): Promise<void> {
  if (disabled) {
    if (!window.confirm(`Disable ${student.username}? They will be signed out and unable to log in.`)) {
      return;
    }
  } else if (!window.confirm(`Enable ${student.username}? They will be able to log in again.`)) {
    return;
  }

  const action = disabled ? 'Disabling' : 'Enabling';
  setBusy(true);
  setRosterStatus(`${action} ${student.username}...`, false);
  hideCredential();

  try {
    const response = await apiRequest<SchoolStudentDisableResponse | SchoolStudentEnableResponse>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}/teacher/students/${encodeURIComponent(student.id)}/${disabled ? 'disable' : 'enable'}`,
      { method: 'POST' },
    );
    students = students.map((item) => (item.id === response.student.id ? response.student : item));
    setRosterStatus(
      disabled ? `Disabled ${response.student.username}.` : `Enabled ${response.student.username}.`,
      false,
    );
    renderStudents();
  } catch (error) {
    setRosterStatus(getErrorMessage(error, disabled ? 'Failed to disable student.' : 'Failed to enable student.'), true);
  } finally {
    setBusy(false);
  }
}

function renderStudents(): void {
  if (!studentsBody) {
    return;
  }

  studentsBody.replaceChildren();
  for (const student of students) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const localName = document.createElement('input');
    localName.type = 'text';
    localName.autocomplete = 'off';
    localName.value = localRoster[student.id]?.localName ?? '';
    localName.placeholder = 'Local only';
    localName.addEventListener('input', () => {
      localRoster[student.id] = { localName: localName.value };
      saveLocalRoster();
    });
    nameCell.append(localName);

    const usernameCell = document.createElement('td');
    usernameCell.textContent = student.username;

    const statusCell = document.createElement('td');
    statusCell.textContent = student.disabledAt
      ? 'Disabled'
      : student.passwordResetRequired
        ? 'Temporary password'
        : 'Active';

    const lastLoginCell = document.createElement('td');
    lastLoginCell.textContent = student.lastLoginAt ? formatDate(student.lastLoginAt) : 'Never';

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions-cell';
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset Password';
    resetButton.disabled = busy || Boolean(student.disabledAt);
    resetButton.addEventListener('click', () => {
      void resetPassword(student);
    });
    const accessButton = document.createElement('button');
    accessButton.type = 'button';
    accessButton.setAttribute('role', 'switch');
    accessButton.setAttribute('aria-checked', student.disabledAt ? 'false' : 'true');
    if (student.disabledAt) {
      accessButton.textContent = 'Enable';
    } else {
      accessButton.className = 'danger';
      accessButton.textContent = 'Disable';
    }
    accessButton.disabled = busy;
    accessButton.addEventListener('click', () => {
      void setStudentDisabled(student, !student.disabledAt);
    });
    actionsCell.append(resetButton, ' ', accessButton);

    row.append(nameCell, usernameCell, statusCell, lastLoginCell, actionsCell);
    studentsBody.append(row);
  }
}

function showCredential(student: SchoolStudentRecord, temporaryPassword: string): void {
  lastCredentialCard = [
    `Username: ${student.username}`,
    `Temporary password: ${temporaryPassword}`,
    '',
    'Go to the classroom student login link and set a new password.',
  ].join('\n');
  if (credentialText) {
    credentialText.replaceChildren();
    const username = document.createElement('div');
    username.innerHTML = `Username: <code>${escapeHtml(student.username)}</code>`;
    const password = document.createElement('div');
    password.innerHTML = `Temporary password: <code>${escapeHtml(temporaryPassword)}</code>`;
    credentialText.append(username, password);
  }
  credentialPanel?.classList.remove('hidden');
}

function hideCredential(): void {
  lastCredentialCard = '';
  credentialPanel?.classList.add('hidden');
  credentialText?.replaceChildren();
}

async function copyLastCredential(): Promise<void> {
  if (!lastCredentialCard) {
    return;
  }
  await navigator.clipboard.writeText(lastCredentialCard);
  setRosterStatus('Login card copied.', false);
}

function exportJsonBackup(): void {
  const rows = buildBackupRows();
  downloadText(
    `school-roster-${classroomSlug}.json`,
    JSON.stringify({ classroomSlug, exportedAt: new Date().toISOString(), students: rows }, null, 2),
    'application/json',
  );
}

function exportCsvBackup(): void {
  const rows = buildBackupRows();
  const csv = [
    ['local_name', 'username', 'student_id'].map(escapeCsvCell).join(','),
    ...rows.map((row) => [row.localName, row.username, row.studentId ?? ''].map(escapeCsvCell).join(',')),
  ].join('\n');
  downloadText(`school-roster-${classroomSlug}.csv`, csv, 'text/csv');
}

async function importBackup(): Promise<void> {
  const file = importInput?.files?.[0] ?? null;
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const importedRows = file.name.toLowerCase().endsWith('.json')
      ? parseJsonBackup(text)
      : parseCsvBackup(text);
    mergeImportedRows(importedRows);
    saveLocalRoster();
    setRosterStatus(`Imported ${importedRows.length} local roster row${importedRows.length === 1 ? '' : 's'}.`, false);
    renderStudents();
  } catch (error) {
    setRosterStatus(getErrorMessage(error, 'Failed to import roster backup.'), true);
  } finally {
    if (importInput) {
      importInput.value = '';
    }
  }
}

function buildBackupRows(): LocalRosterBackupRow[] {
  return students.map((student) => ({
    studentId: student.id,
    username: student.username,
    localName: localRoster[student.id]?.localName ?? '',
  }));
}

function parseJsonBackup(text: string): LocalRosterBackupRow[] {
  const parsed = JSON.parse(text) as { students?: unknown };
  if (!Array.isArray(parsed.students)) {
    throw new Error('JSON backup must contain a students array.');
  }
  return parsed.students.map((row) => normalizeBackupRow(row));
}

function parseCsvBackup(text: string): LocalRosterBackupRow[] {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim()));
  if (rows.length <= 1) {
    return [];
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const localNameIndex = header.indexOf('local_name');
  const usernameIndex = header.indexOf('username');
  const studentIdIndex = header.indexOf('student_id');
  if (localNameIndex < 0 || usernameIndex < 0) {
    throw new Error('CSV backup must include local_name and username columns.');
  }

  return rows.slice(1).map((row) => ({
    localName: row[localNameIndex] ?? '',
    username: row[usernameIndex] ?? '',
    studentId: studentIdIndex >= 0 ? row[studentIdIndex] : undefined,
  }));
}

function mergeImportedRows(rows: LocalRosterBackupRow[]): void {
  for (const row of rows) {
    const matched = row.studentId
      ? students.find((student) => student.id === row.studentId)
      : students.find((student) => student.username === row.username);
    if (!matched) {
      continue;
    }

    localRoster[matched.id] = {
      localName: row.localName,
    };
  }
}

function normalizeBackupRow(value: unknown): LocalRosterBackupRow {
  if (!value || typeof value !== 'object') {
    throw new Error('Roster row is invalid.');
  }
  const row = value as Partial<LocalRosterBackupRow>;
  return {
    studentId: typeof row.studentId === 'string' ? row.studentId : undefined,
    username: typeof row.username === 'string' ? row.username : '',
    localName: typeof row.localName === 'string' ? row.localName : '',
  };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function loadLocalRoster(): Record<string, LocalRosterEntry> {
  if (!classroomSlug) {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localRosterKey) ?? '{}') as Record<string, LocalRosterEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalRoster(): void {
  window.localStorage.setItem(localRosterKey, JSON.stringify(localRoster));
}

function showDebugLink(rawMagicLink: string): void {
  if (!debugLink) {
    return;
  }
  debugLink.href = normalizeDebugMagicLink(rawMagicLink);
  debugLink.classList.remove('hidden');
}

function hideDebugLink(): void {
  debugLink?.classList.add('hidden');
  debugLink?.removeAttribute('href');
}

function normalizeDebugMagicLink(rawMagicLink: string): string {
  const apiBase = getApiBaseUrl().replace(/\/+$/, '');
  if (!apiBase) {
    return rawMagicLink;
  }

  try {
    const magicLinkUrl = new URL(rawMagicLink);
    if (magicLinkUrl.pathname !== '/api/auth/verify') {
      return rawMagicLink;
    }
    return `${apiBase}${magicLinkUrl.pathname}${magicLinkUrl.search}${magicLinkUrl.hash}`;
  } catch {
    return rawMagicLink;
  }
}

function buildReturnToUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth');
  return url.toString();
}

function stripAuthQuery(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth')) {
    return;
  }
  url.searchParams.delete('auth');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  for (const button of [
    requestLinkButton,
    createStudentButton,
    copyCredentialButton,
    exportJsonButton,
    exportCsvButton,
    importButton,
  ]) {
    if (button) {
      button.disabled = busy;
    }
  }
  renderStudents();
}

function setRosterStatus(message: string, isError: boolean): void {
  if (!rosterStatus) {
    return;
  }
  rosterStatus.textContent = message;
  rosterStatus.classList.toggle('error', isError);
}

function setPageStatus(message: string, isError: boolean): void {
  if (!pageStatus) {
    return;
  }
  pageStatus.textContent = message;
  pageStatus.classList.toggle('error', isError);
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compareStudents(left: SchoolStudentRecord, right: SchoolStudentRecord): number {
  return left.username.localeCompare(right.username);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

