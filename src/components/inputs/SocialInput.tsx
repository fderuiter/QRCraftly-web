import React from "react";
import { SocialData, SocialPlatform } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { FormBlock } from "../ui/FormBlock";

interface SocialInputProps {
  data: SocialData;
  onChange: (updates: Partial<SocialData>) => void;
}

export const SocialInput: React.FC<SocialInputProps> = ({ data, onChange }) => {
  return (
    <FormBlock legend="Social Media Profile">
      <SelectField
        id="social-platform"
        label="Platform"
        value={data.platform}
        onChange={(e) =>
          onChange({ platform: e.target.value as SocialPlatform })
        }
      >
        <option value={SocialPlatform.INSTAGRAM}>Instagram</option>
        <option value={SocialPlatform.TWITTER}>Twitter / X</option>
        <option value={SocialPlatform.TIKTOK}>TikTok</option>
        <option value={SocialPlatform.LINKEDIN}>LinkedIn</option>
        <option value={SocialPlatform.YOUTUBE}>YouTube</option>
        <option value={SocialPlatform.FACEBOOK}>Facebook</option>
        <option value={SocialPlatform.WHATSAPP}>WhatsApp</option>
        <option value={SocialPlatform.GITHUB}>GitHub</option>
      </SelectField>
      <TextField
        id="social-handle"
        label="Username / Handle"
        type="text"
        placeholder="@username"
        maxLength={64}
        value={data.handle}
        onChange={(e) => onChange({ handle: e.target.value })}
        showCharCount
      />
    </FormBlock>
  );
};
