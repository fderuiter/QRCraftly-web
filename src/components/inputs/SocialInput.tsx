import React, { useEffect, useState } from "react";
import { type SocialData, SocialPlatform } from "../../types";
import { TextField, SelectField, TextAreaField } from "../ui/FormFields";
import { FormBlock } from "../ui/FormBlock";

interface SocialInputProps {
  data: SocialData;
  onChange: (updates: Partial<SocialData>) => void;
}

export const SocialInput: React.FC<SocialInputProps> = ({ data, onChange }) => {
  const isYouTube = data.platform === SocialPlatform.YOUTUBE;
  const [parseYouTubeInput, setParseYouTubeInput] = useState<((input: string) => string) | null>(null);

  useEffect(() => {
    if (isYouTube && !parseYouTubeInput) {
      import("@/packages/qr-payload/youtube").then((mod) => {
        setParseYouTubeInput(() => mod.parseYouTubeInput);
      });
    }
  }, [isYouTube, parseYouTubeInput]);

  const handleLabel = isYouTube ? "Username / Channel / Video Link" : "Username / Handle";
  const handlePlaceholder = isYouTube ? "@channel, video link, or channel ID" : "@username";
  const handleMaxLength = isYouTube ? 256 : 64;

  const handleHandleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    onChange({ handle: isYouTube && parseYouTubeInput ? parseYouTubeInput(raw) || raw : raw });
  };

  return (
    <FormBlock legend="Social Media Profile">
      <SelectField
        id="social-platform"
        label="Platform"
        value={data.platform}
        onChange={(e) => onChange({ platform: e.target.value as SocialPlatform })}
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
        label={handleLabel}
        type="text"
        placeholder={handlePlaceholder}
        maxLength={handleMaxLength}
        value={data.handle}
        onChange={handleHandleChange}
        showCharCount
      />
      {data.platform === SocialPlatform.WHATSAPP && (
        <TextAreaField
          id="social-message"
          label="Pre-filled Message"
          contextualLabel="Optional"
          placeholder="Enter pre-filled message..."
          rows={3}
          maxLength={256}
          value={data.message || ""}
          onChange={(e) => onChange({ message: e.target.value })}
          showCharCount
        />
      )}
    </FormBlock>
  );
};
