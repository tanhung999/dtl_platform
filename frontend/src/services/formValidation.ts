type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface Details { label?: string; type?: string; min?: string; max?: string; minLength?: number; maxLength?: number }

export function vietnameseValidationMessage(validity: ValidityState, details: Details = {}): string {
  const label = details.label?.trim();
  const name = label ? label.charAt(0).toLocaleLowerCase('vi-VN') + label.slice(1) : 'thông tin này';
  if (validity.valueMissing) {
    if (details.type === 'checkbox') return 'Vui lòng tích vào ô này để tiếp tục.';
    if (details.type === 'radio' || details.type?.startsWith('select')) return `Vui lòng chọn ${name}.`;
    return `Vui lòng nhập ${name}.`;
  }
  if (validity.typeMismatch) return details.type === 'email' ? 'Vui lòng nhập địa chỉ email hợp lệ.' : 'Vui lòng nhập địa chỉ liên kết hợp lệ.';
  if (validity.tooShort) return `Vui lòng nhập ít nhất ${details.minLength} ký tự.`;
  if (validity.tooLong) return `Vui lòng nhập tối đa ${details.maxLength} ký tự.`;
  if (validity.rangeUnderflow) return `Giá trị phải lớn hơn hoặc bằng ${details.min}.`;
  if (validity.rangeOverflow) return `Giá trị phải nhỏ hơn hoặc bằng ${details.max}.`;
  if (validity.badInput) return 'Vui lòng nhập một giá trị hợp lệ.';
  if (validity.patternMismatch) return `Vui lòng nhập đúng định dạng ${name}.`;
  if (validity.stepMismatch) return 'Giá trị chưa hợp lệ. Vui lòng chọn lại.';
  return validity.valid ? '' : 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.';
}

// Native validation follows the browser language, even when <html lang="vi">.
// Capture invalid before the browser displays its popup; preserve business rules
// already supplied by DatePicker, TimePicker and reminder validation.
export function installVietnameseValidation(doc: Document = document) {
  const messages = new WeakMap<Control, string>();
  const control = (target: EventTarget | null): target is Control => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  const clear = (field: Control) => {
    const previous = messages.get(field);
    if (previous && field.validationMessage === previous) field.setCustomValidity('');
    messages.delete(field);
  };
  const labelFor = (field: Control) => field.getAttribute('aria-label') || field.labels?.[0]?.textContent?.trim()
    || field.closest('.form-group')?.querySelector('label')?.textContent?.trim() || undefined;
  const requiredText = (field: Control) => vietnameseValidationMessage({ valueMissing: true } as ValidityState, { label: labelFor(field), type: field.type });
  const blankRequired = (field: Control) => field.willValidate && field.required
    && ['text', 'search', 'email', 'url', 'tel', 'textarea'].includes(field.type) && !field.value.trim();
  const invalid = (event: Event) => {
    if (!control(event.target)) return;
    const field = event.target;
    clear(field);
    if (field.validity.customError) return;
    const message = blankRequired(field) ? requiredText(field) : vietnameseValidationMessage(field.validity, { label: labelFor(field), type: field.type,
      min: field.getAttribute('min') ?? undefined, max: field.getAttribute('max') ?? undefined,
      minLength: Number(field.getAttribute('minlength')), maxLength: Number(field.getAttribute('maxlength')) });
    if (message) { field.setCustomValidity(message); messages.set(field, message); }
  };
  const changed = (event: Event) => { if (control(event.target)) clear(event.target); };
  const submit = (event: Event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    let blank = false;
    for (const element of event.target.elements) {
      if (!control(element) || !blankRequired(element)) continue;
      const message = requiredText(element); element.setCustomValidity(message); messages.set(element, message); blank = true;
    }
    if (blank) { event.preventDefault(); event.stopPropagation(); event.target.reportValidity(); }
  };
  const reset = (event: Event) => { if (event.target instanceof HTMLFormElement) for (const field of event.target.elements) if (control(field)) clear(field); };
  doc.addEventListener('invalid', invalid, true);
  doc.addEventListener('input', changed, true);
  doc.addEventListener('change', changed, true);
  doc.addEventListener('submit', submit, true);
  doc.addEventListener('reset', reset, true);
  return () => {
    doc.removeEventListener('invalid', invalid, true); doc.removeEventListener('input', changed, true);
    doc.removeEventListener('change', changed, true); doc.removeEventListener('submit', submit, true); doc.removeEventListener('reset', reset, true);
  };
}
