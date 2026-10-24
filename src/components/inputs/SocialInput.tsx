import React, { useEffect, useState } from 'react';
import { type SocialData, SocialPlatform } from '../../types';
import { TextField, SelectField, TextAreaField } from '../ui/FormFields';
import { FormBlock } from '../ui/FormBlock';

interface SocialInputProps {
  data: SocialData;
  onChange: (updates: Partial<SocialData>) => void;
}

let yt: typeof import('@/packages/qr-payload/youtube') | null = null;

export const SocialInput: React.FC<SocialInputProps> = ({ data, onChange }) => {
  const isYt = data.platform === SocialPlatform.YOUTUBE;
  const [, setLoaded] = useState(false);

  useEffect(() => {
    if (isYt && !yt) {
      import('@/packages/qr-payload/youtube').then((m) => {
        yt = m;
        setLoaded(true);
      });
    }
  }, [isYt]);

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
        label={isYt ? yt?.YT_LABEL || 'Username / Channel / Video Link' : 'Username / Handle'}
        type="text"
        placeholder={isYt ? yt?.YT_PLACEHOLDER || '@channel, video link, or channel ID' : '@username'}
        maxLength={isYt ? 256 : 64}
        value={data.handle}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ handle: isYt && yt ? yt.parseYouTubeInput(v) || v : v });
        }}
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
          value={data.message || ''}
          onChange={(e) => onChange({ message: e.target.value })}
          showCharCount
        />
      )}
    </FormBlock>
  );
};
