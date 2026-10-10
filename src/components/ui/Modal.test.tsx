import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal Component Accessibility and Behavior', () => {
  it('should have zero accessibility violations when open', async () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });

  it('should not render anything when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    const backdrop = document.body.querySelector('[role="presentation"]');
    expect(backdrop).toBeNull();
  });

  it('should close when Escape key is pressed', async () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    
    await userEvent.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('should lock body scroll when open and restore when closed', () => {
    const initialOverflow = document.body.style.overflow;

    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    expect(document.body.style.overflow).toBe(initialOverflow);
  });

  it('should trap focus and restore focus on open/close cycles', async () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <button data-testid="button1">Button 1</button>
        <button data-testid="button2">Button 2</button>
      </Modal>
    );

    // Wait for auto-focus to trigger (it has a 50ms timeout)
    await new Promise((resolve) => setTimeout(resolve, 60));

    const closeBtn = document.querySelector('[aria-label="Close modal"]') as HTMLElement;
    const btn1 = document.querySelector('[data-testid="button1"]') as HTMLElement;
    const btn2 = document.querySelector('[data-testid="button2"]') as HTMLElement;

    expect(document.activeElement).toBe(closeBtn);

    await userEvent.tab();
    expect(document.activeElement).toBe(btn1);

    await userEvent.tab();
    expect(document.activeElement).toBe(btn2);

    await userEvent.tab();
    expect(document.activeElement).toBe(closeBtn);

    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(btn2);

    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <button data-testid="button1">Button 1</button>
        <button data-testid="button2">Button 2</button>
      </Modal>
    );

    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it('should dynamically set aria-hidden="true" on sibling elements when open and restore them on close', () => {
    // Create a sibling element in document.body
    const sibling1 = document.createElement('div');
    sibling1.id = 'sibling1';
    document.body.appendChild(sibling1);

    const sibling2 = document.createElement('div');
    sibling2.id = 'sibling2';
    sibling2.setAttribute('aria-hidden', 'false');
    document.body.appendChild(sibling2);

    const { rerender } = render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    // Verify modal itself (the presentation backdrop) does NOT have aria-hidden set on it by the sibling logic
    const modalBackdrop = document.body.querySelector('[role="presentation"]') as HTMLElement;
    expect(modalBackdrop).not.toHaveAttribute('aria-hidden');

    // Sibling elements must have aria-hidden="true"
    expect(sibling1).toHaveAttribute('aria-hidden', 'true');
    expect(sibling2).toHaveAttribute('aria-hidden', 'true');

    // Close the modal
    rerender(
      <Modal isOpen={false} onClose={() => {}} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    // Sibling elements must be restored to their prior state
    expect(sibling1).not.toHaveAttribute('aria-hidden');
    expect(sibling2).toHaveAttribute('aria-hidden', 'false');

    // Clean up
    document.body.removeChild(sibling1);
    document.body.removeChild(sibling2);
  });

  describe('Backdrop and Decoupled Layout Behavior', () => {
    it('should assign role="dialog" and other dialog attributes to the inner card and role="presentation" to the outer backdrop', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Test Modal">
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      // The outer container has the backdrop classes and presentation role
      const outerContainer = document.body.querySelector('[role="presentation"]') as HTMLElement;
      expect(outerContainer).toHaveClass('bg-scrim');
      expect(outerContainer).toHaveAttribute('role', 'presentation');
      expect(outerContainer).not.toHaveAttribute('role', 'dialog');

      // The inner content card has role="dialog", aria-modal="true", and references the title
      const dialogCard = document.body.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialogCard).toBeInTheDocument();
      expect(dialogCard).toHaveAttribute('aria-modal', 'true');
      const titleId = dialogCard.getAttribute('aria-labelledby') ?? '';
      expect(titleId).toMatch(/^modal-title-/);
      expect(document.getElementById(titleId)).toHaveTextContent('Test Modal');
      expect(dialogCard).toHaveAccessibleName('Test Modal');
    });

    it('gives each open dialog its own title id', () => {
      render(
        <>
          <Modal isOpen={true} onClose={() => {}} title="First">one</Modal>
          <Modal isOpen={true} onClose={() => {}} title="Second">two</Modal>
        </>
      );
      const dialogs = Array.from(document.body.querySelectorAll('[role="dialog"]'));
      expect(dialogs).toHaveLength(2);
      const ids = dialogs.map((d) => d.getAttribute('aria-labelledby'));
      expect(new Set(ids).size).toBe(2);
      expect(dialogs[0]).toHaveAccessibleName('First');
      expect(dialogs[1]).toHaveAccessibleName('Second');
    });

    it('should NOT dismiss when clicking the backdrop if dismissOnBackdropClick is false (default)', async () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal">
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      const backdrop = document.body.querySelector('[role="presentation"]') as HTMLElement;
      await userEvent.click(backdrop);
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('should dismiss when clicking the backdrop if dismissOnBackdropClick is true', async () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal" dismissOnBackdropClick={true}>
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      const backdrop = document.body.querySelector('[role="presentation"]') as HTMLElement;
      await userEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should NOT dismiss when clicking inside the content card even if dismissOnBackdropClick is true', async () => {
      const handleClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal" dismissOnBackdropClick={true}>
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      const innerContent = document.querySelector('[data-testid="inner-content"]') as HTMLElement;
      await userEvent.click(innerContent);
      expect(handleClose).not.toHaveBeenCalled();
    });

    it('should still dismiss via Escape key regardless of the dismissOnBackdropClick setting', async () => {
      const handleClose = vi.fn();
      const { rerender } = render(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal" dismissOnBackdropClick={false}>
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      await userEvent.keyboard('{Escape}');
      expect(handleClose).toHaveBeenCalledTimes(1);

      handleClose.mockClear();

      rerender(
        <Modal isOpen={true} onClose={handleClose} title="Test Modal" dismissOnBackdropClick={true}>
          <div data-testid="inner-content">Modal Content</div>
        </Modal>
      );

      await userEvent.keyboard('{Escape}');
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  it('offers a large size that fills the screen on phones, with a custom close label', async () => {
    const { getByRole } = render(
      <Modal isOpen={true} onClose={() => {}} title="Scan a QR code" size="lg" closeLabel="Close scanner">
        <div>Viewfinder</div>
      </Modal>
    );
    const dialog = getByRole('dialog', { name: 'Scan a QR code' });
    expect(dialog).toHaveClass('h-full', 'max-w-3xl');
    expect(getByRole('button', { name: 'Close scanner' })).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
