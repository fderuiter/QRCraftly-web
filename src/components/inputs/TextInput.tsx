import React from "react";
import { type TextData, QRType } from "../../types";
import { describeViolation } from "@/packages/qr-payload";
import { findBlockingViolation } from "./linkViolations";
import { TextAreaField } from "../ui/FormFields";

interface TextInputProps {
  data: TextData;
  onChange: (updates: Partial<TextData>) => void;
}

export const TextInput: React.FC<TextInputProps> = ({ data, onChange }) => {
  const violation = findBlockingViolation(QRType.TEXT, data);

  return (
    <div>
      <TextAreaField
        id="text-content"
        label="Content"
        rows={4}
        maxLength={2500}
        placeholder="Enter your text here..."
        value={data.text}
        onChange={(e) => onChange({ text: e.target.value })}
        showCharCount
        error={violation ? describeViolation(violation) : undefined}
      />
    </div>
  );
};
