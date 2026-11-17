import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect } from 'vitest';
import { TextAreaField, SelectField, CheckboxField } from './FormFields';
import { FormFieldContainer } from './FieldWrapper';

describe('FormFields Components', () => {
  describe('TextAreaField', () => {
    it('applies className solely to FieldWrapper and omits it from inner textarea element', () => {
      const { container } = render(
        <TextAreaField label="Bio" className="custom-wrapper-class" />
      );
      const wrapper = container.firstElementChild;
      const textarea = screen.getByLabelText('Bio');

      expect(wrapper).toHaveClass('custom-wrapper-class');
      expect(textarea).not.toHaveClass('custom-wrapper-class');
    });

    it('applies inputClassName solely to inner textarea element and omits it from FieldWrapper', () => {
      const { container } = render(
        <TextAreaField label="Bio" inputClassName="custom-textarea-class" />
      );
      const wrapper = container.firstElementChild;
      const textarea = screen.getByLabelText('Bio');

      expect(textarea).toHaveClass('custom-textarea-class');
      expect(wrapper).not.toHaveClass('custom-textarea-class');
    });

    it('handles empty strings for error and contextualLabel gracefully', () => {
      const { container } = render(
        <TextAreaField label="Bio" contextualLabel="" error="" />
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const textarea = screen.getByLabelText('Bio');
      expect(textarea).toHaveAttribute('aria-invalid', 'false');
      const label = container.querySelector('label');
      expect(label?.querySelectorAll('span').length).toBe(0);
    });

    it('has zero accessibility violations', async () => {
      const { container } = render(
        <TextAreaField label="Description" id="desc-test" className="my-2" inputClassName="p-2" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('SelectField', () => {
    it('applies className solely to FieldWrapper and omits it from inner select element', () => {
      const { container } = render(
        <SelectField label="Country" className="custom-wrapper-class">
          <option value="us">United States</option>
        </SelectField>
      );
      const wrapper = container.firstElementChild;
      const select = screen.getByLabelText('Country');

      expect(wrapper).toHaveClass('custom-wrapper-class');
      expect(select).not.toHaveClass('custom-wrapper-class');
    });

    it('applies inputClassName solely to inner select element and omits it from FieldWrapper', () => {
      const { container } = render(
        <SelectField label="Country" inputClassName="custom-select-class">
          <option value="us">United States</option>
        </SelectField>
      );
      const wrapper = container.firstElementChild;
      const select = screen.getByLabelText('Country');

      expect(select).toHaveClass('custom-select-class');
      expect(wrapper).not.toHaveClass('custom-select-class');
    });

    it('handles empty strings for error and contextualLabel gracefully', () => {
      const { container } = render(
        <SelectField label="Country" contextualLabel="" error="">
          <option value="us">United States</option>
        </SelectField>
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const select = screen.getByLabelText('Country');
      expect(select).toHaveAttribute('aria-invalid', 'false');
      const label = container.querySelector('label');
      expect(label?.querySelectorAll('span').length).toBe(0);
    });

    it('has zero accessibility violations', async () => {
      const { container } = render(
        <SelectField label="Options" id="options-test" className="w-full">
          <option value="1">Option 1</option>
        </SelectField>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('CheckboxField', () => {
    it('renders label and contextualLabel correctly', () => {
      render(
        <CheckboxField
          label="I agree"
          contextualLabel="required"
          id="terms"
        />
      );
      const checkbox = screen.getByLabelText(/I agree/);
      expect(checkbox).toHaveAttribute('type', 'checkbox');
      expect(screen.getByText('(required)')).toBeInTheDocument();
    });

    it('handles empty strings for error and contextualLabel gracefully', () => {
      render(
        <CheckboxField
          label="Option"
          contextualLabel=""
          error=""
        />
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const checkbox = screen.getByLabelText('Option');
      expect(checkbox).toHaveAttribute('aria-invalid', 'false');
    });

    it('has zero accessibility violations', async () => {
      const { container } = render(
        <CheckboxField label="Subscribe" id="subscribe-check" />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('FormFieldContainer', () => {
    it('supports render prop and passes correct inputId and describedBy', () => {
      render(
        <FormFieldContainer
          id="custom-container"
          label="Custom Container"
          error="Container Error"
          showCharCount
          maxLength={50}
          value="hello"
          render={({ inputId, describedBy, errorId, charCountId }) => (
            <input id={inputId} aria-describedby={describedBy} data-error-id={errorId} data-char-id={charCountId} />
          )}
        />
      );

      const input = screen.getByLabelText('Custom Container');
      expect(input).toHaveAttribute('id', 'custom-container');
      expect(input).toHaveAttribute('aria-describedby', 'custom-container-error custom-container-char-count');
      expect(input).toHaveAttribute('data-error-id', 'custom-container-error');
      expect(input).toHaveAttribute('data-char-id', 'custom-container-char-count');
      expect(screen.getByRole('alert')).toHaveTextContent('Container Error');
    });

    it('does not render character counter when showCharCount is true but maxLength is omitted', () => {
      const { container } = render(
        <FormFieldContainer
          id="no-max-length"
          label="No Max"
          showCharCount
          value="sample text"
        >
          {({ inputId }) => <input id={inputId} />}
        </FormFieldContainer>
      );

      expect(container.querySelector('[aria-live="polite"]')).not.toBeInTheDocument();
    });
  });
});

