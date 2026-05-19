import { apiRequest } from './api/request';
import type {
  SchoolClassroomPublic,
  SchoolStudentLoginResponse,
} from './school/model';

const params = new URL(window.location.href).searchParams;
const classroomSlug = params.get('classroom')?.trim() ?? '';

const classroomName = document.getElementById('classroom-name');
const form = document.getElementById('login-form') as HTMLFormElement | null;
const usernameInput = document.getElementById('username-input') as HTMLInputElement | null;
const passwordInput = document.getElementById('password-input') as HTMLInputElement | null;
const resetFields = document.getElementById('reset-fields');
const newPasswordInput = document.getElementById('new-password-input') as HTMLInputElement | null;
const confirmPasswordInput = document.getElementById('confirm-password-input') as HTMLInputElement | null;
const submitButton = document.getElementById('submit-button') as HTMLButtonElement | null;
const statusEl = document.getElementById('status');

let busy = false;
let resetRequired = false;

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitLogin();
});

void initialize();

async function initialize(): Promise<void> {
  if (!classroomSlug) {
    setStatus('Missing classroom link.', true);
    setFormEnabled(false);
    return;
  }

  try {
    const response = await apiRequest<{ classroom: SchoolClassroomPublic }>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}`,
    );
    if (classroomName) {
      classroomName.textContent = response.classroom.displayName;
    }
    setStatus('', false);
  } catch (error) {
    setStatus(getErrorMessage(error, 'Classroom not found.'), true);
    setFormEnabled(false);
  }
}

async function submitLogin(): Promise<void> {
  if (busy) {
    return;
  }

  const username = usernameInput?.value.trim() ?? '';
  const password = passwordInput?.value ?? '';
  const newPassword = newPasswordInput?.value ?? '';
  const confirmPassword = confirmPasswordInput?.value ?? '';

  if (!username || !password) {
    setStatus('Enter your username and password.', true);
    return;
  }

  if (resetRequired) {
    if (!newPassword || !confirmPassword) {
      setStatus('Enter and confirm your new password.', true);
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('New passwords do not match.', true);
      return;
    }
  }

  setBusy(true);
  setStatus(resetRequired ? 'Saving new password...' : 'Signing in...', false);

  try {
    const body: Record<string, string> = {
      username,
      password,
    };
    if (resetRequired) {
      body.newPassword = newPassword;
    }

    const response = await apiRequest<SchoolStudentLoginResponse>(
      `/api/school/classrooms/${encodeURIComponent(classroomSlug)}/student-login`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );

    if (response.passwordResetRequired) {
      resetRequired = true;
      resetFields?.classList.remove('hidden');
      if (submitButton) {
        submitButton.textContent = 'Set Password';
      }
      newPasswordInput?.focus();
      setStatus('Set a new password to finish signing in.', false);
      return;
    }

    if (response.authenticated) {
      window.location.replace('./?auth=school');
      return;
    }

    setStatus('Sign-in did not complete. Try again.', true);
  } catch (error) {
    setStatus(getErrorMessage(error, 'Sign-in failed.'), true);
  } finally {
    setBusy(false);
  }
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  setFormEnabled(!busy);
}

function setFormEnabled(enabled: boolean): void {
  for (const element of [
    usernameInput,
    passwordInput,
    newPasswordInput,
    confirmPasswordInput,
    submitButton,
  ]) {
    if (element) {
      element.disabled = !enabled;
    }
  }
}

function setStatus(message: string, isError: boolean): void {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

