import { SIGN_TEXT_MAX_LENGTH } from './model';

export const SIGN_TEXT_EDIT_REQUEST_EVENT = 'sign-text-edit-request';

export interface SignTextEditRequestDetail {
  instanceId: string;
  objectId: string;
  objectLabel: string;
  currentText: string;
  contextHint: string | null;
  maxLength: number;
}

export function requestSignTextEdit(
  detail: Omit<SignTextEditRequestDetail, 'maxLength'> & { maxLength?: number },
): void {
  window.dispatchEvent(
    new CustomEvent<SignTextEditRequestDetail>(SIGN_TEXT_EDIT_REQUEST_EVENT, {
      detail: {
        ...detail,
        maxLength: detail.maxLength ?? SIGN_TEXT_MAX_LENGTH,
      },
    }),
  );
}
