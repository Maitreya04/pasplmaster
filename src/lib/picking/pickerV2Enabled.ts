/** Picker v10 UX — enabled via env or sessionStorage for staged rollout. */
export function isPickerV2Enabled(): boolean {
  if (import.meta.env.VITE_PICKER_V2 === '1' || import.meta.env.VITE_PICKER_V2 === 'true') {
    return true;
  }
  if (typeof window !== 'undefined' && window.sessionStorage.getItem('paspl.pickerV2') === '1') {
    return true;
  }
  return false;
}

export function setPickerV2SessionEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) window.sessionStorage.setItem('paspl.pickerV2', '1');
  else window.sessionStorage.removeItem('paspl.pickerV2');
}
