import React from "react";
import { PaymentData, CryptoNetwork } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { isDangerousUrl } from "../../utils/security";
import { FormBlock } from "../ui/FormBlock";
import { checkCryptoAddress, isValidIban } from "@/packages/qr-payload";

interface PaymentInputProps {
  data: PaymentData;
  onChange: (updates: Partial<PaymentData>) => void;
}

const isCryptoNetwork = (network: CryptoNetwork): boolean => {
  return [
    CryptoNetwork.BITCOIN,
    CryptoNetwork.ETHEREUM,
    CryptoNetwork.SOLANA,
    CryptoNetwork.LITECOIN,
  ].includes(network);
};

export const PaymentInput: React.FC<PaymentInputProps> = ({
  data,
  onChange,
}) => {
  const currentAddress = data.network === CryptoNetwork.EPC_SEPA ? (data.iban || data.address || "") : data.address;

  const addressError = currentAddress && isDangerousUrl(currentAddress)
    ? "Unsafe URL scheme or malicious protocol detected."
    : currentAddress &&
        isCryptoNetwork(data.network) &&
        checkCryptoAddress(data.network, currentAddress) === "invalid"
      ? "This address does not pass its built-in check: it has a typo or is not a real address. Money sent to it can be lost. You can still make the code."
      : currentAddress &&
          data.network === CryptoNetwork.EPC_SEPA &&
          !isValidIban(currentAddress)
        ? "This IBAN does not pass its checksum or format check. Double-check for typos."
        : undefined;

  const getAddressConfig = () => {
    switch (data.network) {
      case CryptoNetwork.EPC_SEPA:
        return {
          label: "IBAN",
          placeholder: "e.g. DE89370400440532013000",
        };
      case CryptoNetwork.PAYPAL:
        return {
          label: "PayPal Handle / Username",
          placeholder: "e.g. username or paypal.me/username",
        };
      case CryptoNetwork.VENMO:
        return {
          label: "Venmo Username",
          placeholder: "e.g. @username",
        };
      case CryptoNetwork.CASH_APP:
        return {
          label: "Cashtag / Handle",
          placeholder: "e.g. $username",
        };
      case CryptoNetwork.CUSTOM:
        return {
          label: "Receiver Address / URI",
          placeholder: "Raw Payment Address or URI",
        };
      default:
        return {
          label: "Receiver Address",
          placeholder: "Wallet Address",
        };
    }
  };

  const mainConfig = getAddressConfig();

  return (
    <FormBlock legend="Payment Options">

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
        <option value={CryptoNetwork.EPC_SEPA}>SEPA Credit Transfer (EPC QR)</option>
        <option value={CryptoNetwork.PAYPAL}>PayPal</option>
        <option value={CryptoNetwork.VENMO}>Venmo</option>
        <option value={CryptoNetwork.CASH_APP}>Cash App</option>
        <option value={CryptoNetwork.CUSTOM}>Custom / Raw Address</option>
      </SelectField>

      <TextField
        id="payment-address"
        label={mainConfig.label}
        type="text"
        // An IBAN has at most 34 characters; allow the spaces of its printed four-character groups.
        maxLength={data.network === CryptoNetwork.EPC_SEPA ? 42 : 128}
        placeholder={mainConfig.placeholder}
        value={currentAddress}
        onChange={(e) => {
          const val = e.target.value;
          if (data.network === CryptoNetwork.EPC_SEPA) {
            onChange({ iban: val, address: val });
          } else {
            onChange({ address: val });
          }
        }}
        error={addressError}
      />

      {data.network === CryptoNetwork.EPC_SEPA && (
        <>
          <TextField
            id="payment-name"
            label="Beneficiary Name"
            type="text"
            maxLength={70}
            placeholder="e.g. Jane Doe"
            value={data.name || ""}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <TextField
            id="payment-bic"
            label="BIC / SWIFT"
            contextualLabel="Optional"
            type="text"
            maxLength={11}
            placeholder="e.g. MIDLGB22"
            value={data.bic || ""}
            onChange={(e) => onChange({ bic: e.target.value })}
          />
        </>
      )}

      {data.network !== CryptoNetwork.CUSTOM && (
        <>
          <TextField
            id="payment-amount"
            label={data.network === CryptoNetwork.EPC_SEPA ? "Amount (EUR)" : "Amount"}
            contextualLabel="Optional"
            type="number"
            step="any"
            max="999999999"
            placeholder="0.00"
            value={data.amount || ""}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
          <TextField
            id="payment-label"
            label={data.network === CryptoNetwork.EPC_SEPA ? "Remittance Information / Note" : "Label / Note"}
            contextualLabel="Optional"
            type="text"
            maxLength={data.network === CryptoNetwork.EPC_SEPA ? 140 : 200}
            placeholder={data.network === CryptoNetwork.EPC_SEPA ? "e.g. Invoice 123" : "e.g. Donation"}
            value={data.label || ""}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </>
      )}
    </FormBlock>
  );
};
