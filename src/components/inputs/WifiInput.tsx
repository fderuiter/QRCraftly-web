import React from "react";
import { type WifiData, WifiEncryption, WifiEapMethod, WifiEapPhase2 } from "../../types";
import { TextField, SelectField, CheckboxField } from "../ui/FormFields";
import { CONTAINMENT_PROFILES } from "@/packages/qr-payload";
import { FormBlock } from "../ui/FormBlock";

interface WifiInputProps {
  data: WifiData;
  onChange: (updates: Partial<WifiData>) => void;
}

export const WifiInput: React.FC<WifiInputProps> = ({ data, onChange }) => {
  const ssidError = data.ssid && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(data.ssid)
    ? "Network Name cannot contain control or zero-width characters."
    : undefined;

  const passwordError = data.password && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(data.password)
    ? "Password cannot contain control or zero-width characters."
    : undefined;

  const eapIdentityError = data.eapIdentity && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(data.eapIdentity)
    ? "Identity cannot contain control or zero-width characters."
    : undefined;

  return (
    <FormBlock legend="Network Details">
      <TextField
        id="wifi-ssid"
        label="Network Name (SSID)"
        type="text"
        placeholder="e.g. MyHomeNetwork"
        maxLength={32}
        value={data.ssid}
        onChange={(e) => onChange({ ssid: e.target.value })}
        showCharCount
        error={ssidError}
      />

      <div className="flex-1">
        <SelectField
          id="wifi-encryption"
          label="Encryption"
          value={data.encryption}
          onChange={(e) =>
            onChange({ encryption: e.target.value as WifiEncryption })
          }
        >
          <option value={WifiEncryption.WPA}>
            WPA / WPA2 / WPA3 (Standard)
          </option>
          <option value={WifiEncryption.WEP}>WEP (Legacy)</option>
          <option value={WifiEncryption.WPA2_EAP}>WPA2 Enterprise (EAP)</option>
          <option value={WifiEncryption.NOPASS}>None (Open Network)</option>
        </SelectField>
      </div>

      {data.encryption === WifiEncryption.WPA2_EAP && (
        <SelectField
          id="wifi-eap-method"
          label="EAP Method"
          value={data.eapMethod ?? WifiEapMethod.PEAP}
          onChange={(e) =>
            onChange({ eapMethod: e.target.value as WifiEapMethod })
          }
        >
          <option value={WifiEapMethod.PEAP}>PEAP</option>
          <option value={WifiEapMethod.TTLS}>TTLS</option>
          <option value={WifiEapMethod.TLS}>TLS</option>
          <option value={WifiEapMethod.PWD}>PWD</option>
        </SelectField>
      )}

      {data.encryption === WifiEncryption.WPA2_EAP &&
        (data.eapMethod ?? WifiEapMethod.PEAP) !== WifiEapMethod.TLS &&
        (data.eapMethod ?? WifiEapMethod.PEAP) !== WifiEapMethod.PWD && (
        <SelectField
          id="wifi-eap-phase2"
          label="Phase 2 Authentication"
          value={data.eapPhase2 ?? WifiEapPhase2.MSCHAPV2}
          onChange={(e) =>
            onChange({ eapPhase2: e.target.value as WifiEapPhase2 })
          }
        >
          <option value={WifiEapPhase2.MSCHAPV2}>MSCHAPV2</option>
          <option value={WifiEapPhase2.GTC}>GTC</option>
          <option value={WifiEapPhase2.PAP}>PAP</option>
          <option value={WifiEapPhase2.NONE}>None</option>
        </SelectField>
      )}

      {data.encryption === WifiEncryption.WPA2_EAP && (
        <TextField
          id="wifi-identity"
          label="Identity / Username"
          type="text"
          placeholder="e.g. user@domain.com"
          maxLength={128}
          value={data.eapIdentity}
          onChange={(e) => onChange({ eapIdentity: e.target.value })}
          error={eapIdentityError}
        />
      )}

      {data.encryption !== WifiEncryption.NOPASS && (
        <TextField
          id="wifi-password"
          name="password"
          label="Password"
          autoComplete="off"
          type="password"
          placeholder="Network password"
          maxLength={63}
          value={data.password}
          onChange={(e) => onChange({ password: e.target.value })}
          showPasswordToggle
          showCharCount
          error={passwordError}
        />
      )}

      <CheckboxField
        id="wifi-hidden"
        label="Hidden Network"
        checked={data.hidden}
        onChange={(e) => onChange({ hidden: e.target.checked })}
        className="pt-2"
      />
    </FormBlock>
  );
};
