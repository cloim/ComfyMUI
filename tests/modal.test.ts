import { describe, expect, it, vi } from 'vitest';
import { isTopModal, popModal, pushModal } from '../src/components/Modal/modalStack.js';

describe('Modal stack management (modalStack.js)', () => {
  it('correctly manages modal stack order and determines isTopModal', () => {
    const id1 = 'modal-1';
    const id2 = 'modal-2';
    const id3 = 'modal-3';

    // Push first modal
    const z1 = pushModal(id1);
    expect(z1).toBeGreaterThanOrEqual(1000);
    expect(isTopModal(id1)).toBe(true);
    expect(isTopModal(id2)).toBe(false);

    // Push second modal on top
    const z2 = pushModal(id2);
    expect(z2).toBeGreaterThan(z1);
    expect(isTopModal(id1)).toBe(false);
    expect(isTopModal(id2)).toBe(true);

    // Push third modal
    const z3 = pushModal(id3);
    expect(z3).toBeGreaterThan(z2);
    expect(isTopModal(id3)).toBe(true);

    // Pop top modal
    popModal(id3);
    expect(isTopModal(id2)).toBe(true);
    expect(isTopModal(id3)).toBe(false);

    // Pop middle modal
    popModal(id2);
    expect(isTopModal(id1)).toBe(true);

    // Pop last modal
    popModal(id1);
    expect(isTopModal(id1)).toBe(false);
  });
});

describe('Balance standard modal key interaction rules simulation', () => {
  const POSITIVE_BUTTON_SELECTOR =
    '[data-modal-confirm], [data-modal-positive], .modal-footer .btn-primary, .modal-footer .btn-danger, .modal-footer button[type="submit"], .modal-footer button.primary, .modal-footer a.btn-primary';

  const NEGATIVE_BUTTON_SELECTOR =
    '[data-modal-cancel], [data-modal-negative], .modal-footer .btn-secondary:not([data-modal-no-cancel]), .modal-footer .btn-ghost:not([data-modal-no-cancel]), .modal-footer .modal-cancel, .modal-footer button.cancel';

  interface FakeElement {
    tagName: string;
    type?: string;
    isContentEditable?: boolean;
    attributes: Record<string, string>;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): string | null;
    click: () => void;
    matches: (selector: string) => boolean;
  }

  function createFakeElement(
    tagName: string,
    classes: string[] = [],
    attrs: Record<string, string> = {},
    onClick = vi.fn(),
  ): FakeElement {
    return {
      tagName: tagName.toUpperCase(),
      attributes: { ...attrs },
      hasAttribute: (n) => n in attrs,
      getAttribute: (n) => attrs[n] ?? null,
      click: onClick,
      matches: (sel: string) => {
        if (sel.includes('.btn-primary') && classes.includes('btn-primary')) return true;
        if (sel.includes('.btn-danger') && classes.includes('btn-danger')) return true;
        if (sel.includes('.btn-secondary') && classes.includes('btn-secondary')) return true;
        if (sel.includes('.btn-ghost') && classes.includes('btn-ghost')) return true;
        if (sel.includes('[data-modal-confirm]') && attrs['data-modal-confirm'] !== undefined)
          return true;
        if (sel.includes('[data-modal-cancel]') && attrs['data-modal-cancel'] !== undefined)
          return true;
        return false;
      },
    };
  }

  function handleModalKeyDown({
    event,
    modalId,
    closeOnEscape = true,
    confirmOnEnter = true,
    onClose,
    onConfirm,
    onCancel,
    activeElement,
    footerButtons = [],
  }: {
    event: {
      key: string;
      keyCode?: number;
      isComposing?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      stopPropagation: () => void;
      preventDefault: () => void;
    };
    modalId: string;
    closeOnEscape?: boolean;
    confirmOnEnter?: boolean;
    onClose?: () => void;
    onConfirm?: () => void;
    onCancel?: () => void;
    activeElement?: FakeElement | null;
    footerButtons?: FakeElement[];
  }) {
    if (!isTopModal(modalId)) {
      return;
    }

    // ESC: 부정 버튼 클릭 또는 onCancel/onClose 호출
    if (event.key === 'Escape' && closeOnEscape) {
      event.stopPropagation();
      event.preventDefault();

      if (typeof onCancel === 'function') {
        onCancel();
        return;
      }

      const negativeButton = footerButtons.find(
        (b) =>
          (b.matches('[data-modal-cancel]') ||
            b.matches('.modal-footer .btn-secondary') ||
            b.matches('.modal-footer .btn-ghost')) &&
          !b.hasAttribute('disabled') &&
          b.getAttribute('aria-disabled') !== 'true' &&
          !b.hasAttribute('data-modal-no-cancel'),
      );
      if (negativeButton) {
        negativeButton.click();
        return;
      }

      onClose?.();
      return;
    }

    // Enter: 긍정 버튼 클릭 또는 onConfirm 호출
    if (event.key === 'Enter' && confirmOnEnter && !event.isComposing && event.keyCode !== 229) {
      if (event.shiftKey || event.altKey) {
        return;
      }

      const tagName = activeElement?.tagName?.toLowerCase();
      const isInsideModal = activeElement ? true : false;

      // textarea나 contenteditable 영역은 줄바꿈 입력을 보존한다 (단, Ctrl/Cmd + Enter는 확인 허용).
      if (
        isInsideModal &&
        (tagName === 'textarea' || activeElement?.isContentEditable) &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        return;
      }

      // 이미 버튼이나 링크 등에 포커스가 있는 경우 브라우저 네이티브 활성화 동작에 맡긴다.
      if (
        isInsideModal &&
        (tagName === 'button' ||
          tagName === 'a' ||
          (tagName === 'input' &&
            ['button', 'submit', 'reset'].includes(activeElement?.type ?? '')))
      ) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();

      if (typeof onConfirm === 'function') {
        onConfirm();
        return;
      }

      const positiveButton = footerButtons.find(
        (b) =>
          (b.matches('[data-modal-confirm]') ||
            b.matches('.modal-footer .btn-primary') ||
            b.matches('.modal-footer .btn-danger')) &&
          !b.hasAttribute('disabled') &&
          b.getAttribute('aria-disabled') !== 'true' &&
          !b.hasAttribute('data-modal-no-confirm'),
      );

      if (positiveButton) {
        positiveButton.click();
        return;
      }
    }
  }

  it('Esc calls onCancel if provided, or clicks negative button, or calls onClose', () => {
    const modalId = 'm1';
    pushModal(modalId);

    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const cancelBtnClick = vi.fn();
    const cancelBtn = createFakeElement('button', ['btn-secondary'], {}, cancelBtnClick);

    // 1. With onCancel
    handleModalKeyDown({
      event: { key: 'Escape', stopPropagation, preventDefault },
      modalId,
      onClose,
      onCancel,
      footerButtons: [cancelBtn],
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(cancelBtnClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // 2. Without onCancel, clicks negative button
    handleModalKeyDown({
      event: { key: 'Escape', stopPropagation, preventDefault },
      modalId,
      onClose,
      footerButtons: [cancelBtn],
    });
    expect(cancelBtnClick).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    // 3. Without negative button, calls onClose
    handleModalKeyDown({
      event: { key: 'Escape', stopPropagation, preventDefault },
      modalId,
      onClose,
      footerButtons: [],
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    popModal(modalId);
  });

  it('Esc ignores negative button if data-modal-no-cancel is set and falls back to onClose', () => {
    const modalId = 'm2';
    pushModal(modalId);

    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const onClose = vi.fn();
    const exportBtnClick = vi.fn();
    const exportBtn = createFakeElement(
      'button',
      ['btn-secondary'],
      { 'data-modal-no-cancel': 'true' },
      exportBtnClick,
    );

    handleModalKeyDown({
      event: { key: 'Escape', stopPropagation, preventDefault },
      modalId,
      onClose,
      footerButtons: [exportBtn],
    });

    expect(exportBtnClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    popModal(modalId);
  });

  it('Enter triggers confirm action unless composing (IME) or keycode 229', () => {
    const modalId = 'm3';
    pushModal(modalId);

    const onConfirm = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    // During Korean IME composing
    handleModalKeyDown({
      event: { key: 'Enter', isComposing: true, stopPropagation, preventDefault },
      modalId,
      onConfirm,
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // keyCode 229
    handleModalKeyDown({
      event: { key: 'Enter', keyCode: 229, stopPropagation, preventDefault },
      modalId,
      onConfirm,
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Normal Enter
    handleModalKeyDown({
      event: { key: 'Enter', isComposing: false, keyCode: 13, stopPropagation, preventDefault },
      modalId,
      onConfirm,
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    popModal(modalId);
  });

  it('Enter preserves newline in textarea, but Ctrl+Enter triggers confirm', () => {
    const modalId = 'm4';
    pushModal(modalId);

    const onConfirm = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const textarea = createFakeElement('textarea');

    // Standalone Enter in textarea
    handleModalKeyDown({
      event: { key: 'Enter', stopPropagation, preventDefault },
      modalId,
      onConfirm,
      activeElement: textarea,
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Ctrl + Enter in textarea
    handleModalKeyDown({
      event: { key: 'Enter', ctrlKey: true, stopPropagation, preventDefault },
      modalId,
      onConfirm,
      activeElement: textarea,
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Meta + Enter in textarea
    handleModalKeyDown({
      event: { key: 'Enter', metaKey: true, stopPropagation, preventDefault },
      modalId,
      onConfirm,
      activeElement: textarea,
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);

    popModal(modalId);
  });

  it('Enter leaves native activation to focused button or link', () => {
    const modalId = 'm5';
    pushModal(modalId);

    const onConfirm = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const focusedButton = createFakeElement('button');

    handleModalKeyDown({
      event: { key: 'Enter', stopPropagation, preventDefault },
      modalId,
      onConfirm,
      activeElement: focusedButton,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();

    popModal(modalId);
  });

  it('Enter clicks positive button in footer when input has focus', () => {
    const modalId = 'm6';
    pushModal(modalId);

    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    const textInput = createFakeElement('input', [], { type: 'text' });
    const saveClick = vi.fn();
    const saveButton = createFakeElement('button', ['btn-primary'], {}, saveClick);

    handleModalKeyDown({
      event: { key: 'Enter', stopPropagation, preventDefault },
      modalId,
      activeElement: textInput,
      footerButtons: [saveButton],
    });

    expect(saveClick).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();

    popModal(modalId);
  });

  it('Ignores key events if not top modal in the stack', () => {
    const bottomModal = 'bottom';
    const topModal = 'top';
    pushModal(bottomModal);
    pushModal(topModal);

    const bottomOnClose = vi.fn();
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    handleModalKeyDown({
      event: { key: 'Escape', stopPropagation, preventDefault },
      modalId: bottomModal,
      onClose: bottomOnClose,
    });

    expect(bottomOnClose).not.toHaveBeenCalled();

    popModal(topModal);
    popModal(bottomModal);
  });
});
