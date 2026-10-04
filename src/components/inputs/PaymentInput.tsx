import React from "react";
import { PaymentData, CryptoNetwork } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { isDangerousUrl } from "../../utils/security";
import { FormBlock } from "../ui/FormBlock";
import { checkCryptoAddress } from "@/packages/qr-payload";

interface PaymentInputProps {
  data: PaymentData;
  onChange: (updates: Partial<PaymentData>) => void;
}

export const PaymentInput: React.FC<PaymentInputProps> = ({
  data,
  onChange,
}) => {
  const addressError = data.address && isDangerousUrl(data.address)
    ? "Unsafe URL scheme or malicious protocol detected."
    : data.address &&
        data.network !== CryptoNetwork.CUSTOM &&
        checkCryptoAddress(data.network, data.address) === "invalid"
      ? "This address does not pass its built-in check: it has a typo or is not a real address. Money sent to it can be lost. You can still make the code."
      : undefined;

  return (
    <FormBlock legend="Crypto Payment">

      <SelectField
        id="payment-network"
        label="Currency / Network"
        value={data.network}
        onChange={(e) => onChange({ network: e.target.value as CryptoNetwork })}
      >
        <option value={CryptoNetwork.BITCOIN}>Bitcoin (BTC)</option>
        <option value={CryptoNetwork.ETHEREUM}>Ethereum (ETH)</option>
        <option value={CryptoNetwork.SOLANA}>Solana (SOL)</option>
        <option value={CryptoNetwork.LITECOIN}>Litecoin (LTC)</option>
        <option value={CryptoNetwork.CUSTOM}>Custom / Raw Address</option>
      </SelectField>

      <TextField
        id="payment-address"
        label="Receiver Address"
        type="text"
        maxLength={128}
        placeholder="Wallet Address"
        value={data.address}
        onChange={(e) => onChange({ address: e.target.value })}
        error={addressError}
      />

      {data.network !== CryptoNetwork.CUSTOM && (
        <>
          <TextField
            id="payment-amount"
            label="Amount"
            contextualLabel="Optional"
            type="number"
            step="any"
            max="999999999"
            placeholder="0.00"
            value={data.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
          <TextField
            id="payment-label"
            label="Label / Note"
            contextualLabel="Optional"
            type="text"
            maxLength={200}
            placeholder="e.g. Donation"
            value={data.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </>
      )}
    </FormBlock>
  );
};
