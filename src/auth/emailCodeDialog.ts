import './emailCodeDialog.css';
import { apiRequest } from '../api/request';

export function openEmailCodeDialog(email: string, debugCode?: string): void {
  document.getElementById('shared-email-code-dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'shared-email-code-dialog';
  dialog.className = 'shared-email-code-dialog';
  dialog.innerHTML = `
    <form method="dialog"><button class="code-close" aria-label="Close" type="submit">×</button></form>
    <div class="code-kicker">SIGN IN TO WAMP</div>
    <h2>Check Your Email</h2>
    <p class="code-address"></p>
    <p>Enter or paste the six-digit code, or use the link in your email.</p>
    <form class="code-form">
      <input aria-label="Six-digit email code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required />
      <button type="submit">Verify Code</button>
    </form>
    <p class="code-status" role="status"></p>
  `;
  dialog.querySelector('.code-address')!.textContent = email;
  const status = dialog.querySelector('.code-status')!;
  status.textContent = debugCode ? `Debug code: ${debugCode}` : 'The code expires in 15 minutes.';
  const input = dialog.querySelector('.code-form input') as HTMLInputElement;
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  dialog.querySelector('.code-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = dialog.querySelector('.code-form button') as HTMLButtonElement;
    submit.disabled = true;
    status.textContent = 'Checking code...';
    void apiRequest('/api/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code: input.value }),
    }).then(() => {
      window.location.reload();
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'Could not verify code.';
      input.focus();
      input.select();
    }).finally(() => { submit.disabled = false; });
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}
