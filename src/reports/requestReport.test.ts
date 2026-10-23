import { afterEach, expect, it, vi } from 'vitest';
const feedback = vi.hoisted(() => ({ free: true }));
vi.mock('../ui/appFeedback', async (original) => ({ ...await original<object>(), showBusyError: vi.fn(), canReplaceBusyCard: () => feedback.free }));
vi.mock('../main/clientErrorReporter', () => ({ reportClientError: vi.fn() }));
// Stands in for the Report dialog's file failing to download.
vi.mock('./reportDialog', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
import { showBusyError } from '../ui/appFeedback';
import { reportClientError } from '../main/clientErrorReporter';
import { requestReport } from './requestReport';

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); feedback.free = true; });

it('a Report form that fails to download shows the reload card once, not a browser alert, and reports once', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); const alert = vi.fn(); vi.stubGlobal('window', { alert });
  requestReport({ type: 'room', id: 'room-1', label: 'Room 1, 0' });
  await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledOnce());
  expect(showBusyError).toHaveBeenCalledExactlyOnceWith(
    "The report form couldn't load. Check your connection, then reload WAMP. Save anything you are working on first.",
    expect.objectContaining({ title: 'Report form', retryLabel: 'Reload', closeLabel: 'Not now' }));
  expect(alert).not.toHaveBeenCalled();
});

it('a Report form failure never covers a save in progress or a choice, but is still reported', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); feedback.free = false;
  requestReport(null);
  await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledOnce());
  expect(showBusyError).not.toHaveBeenCalled();
});
