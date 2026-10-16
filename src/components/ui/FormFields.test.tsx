import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect } from 'vitest';
import { TextAreaField, SelectField, CheckboxField } from './FormFields';

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

    it('handles both className and inputClassName together correctly', () => {
      const { container } = render(
        <TextAreaField
          label="Bio"
          className="outer-layout-class"
          inputClassName="inner-control-class"
        />
      );
      const wrapper = container.firstElementChild;
      const textarea = screen.getByLabelText('Bio');

      expect(wrapper).toHaveClass('outer-layout-class');
      expect(wrapper).not.toHaveClass('inner-control-class');
      expect(textarea).toHaveClass('inner-control-class');
      expect(textarea).not.toHaveClass('outer-layout-class');
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

    it('handles both className and inputClassName together correctly', () => {
      const { container } = render(
        <SelectField
          label="Country"
          className="outer-layout-class"
          inputClassName="inner-control-class"
        >
          <option value="us">United States</option>
        </SelectField>
      );
      const wrapper = container.firstElementChild;
      const select = screen.getByLabelText('Country');

      expect(wrapper).toHaveClass('outer-layout-class');
      expect(wrapper).not.toHaveClass('inner-control-class');
      expect(select).toHaveClass('inner-control-class');
      expect(select).not.toHaveClass('outer-layout-class');
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
    it('applies className to outer FieldWrapper', () => {
      const { container } = render(
        <CheckboxField label="Agree" className="custom-checkbox-wrapper" />
      );
      const wrapper = container.firstElementChild;
      expect(wrapper).toHaveClass('custom-checkbox-wrapper');
    });
  });
});
