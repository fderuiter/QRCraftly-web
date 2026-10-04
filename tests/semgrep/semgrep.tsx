// Fixtures for semgrep.yml. Run with `pnpm run test:semgrep` (needs Semgrep, see requirements.txt).
// Each `ruleid` line must be reported by that rule, each `ok` line must not.
import React from 'react';

declare const isDangerousUrl: (value: string) => boolean;
declare const cleanPhoneNumber: (value: string, keep?: boolean) => string;
declare const encodeDialString: (value: string) => string;
declare const navigate: (to: string) => Promise<void>;
declare const ButtonLink: React.FC<{ href: string; children?: React.ReactNode }>;
declare const userUrl: string;
declare const number: string;
declare const el: HTMLAnchorElement;

export function links() {
  // ruleid: require-isdangerousurl
  const unsafeAnchor = <a href={userUrl}>x</a>;
  // ruleid: require-isdangerousurl
  const unsafeButton = <ButtonLink href={userUrl}>x</ButtonLink>;
  // ok: require-isdangerousurl
  const literalAnchor = <a href="/about">x</a>;
  // ok: require-isdangerousurl
  const literalButton = <ButtonLink href="/about">x</ButtonLink>;
  // ok: require-isdangerousurl
  const fragmentButton = <ButtonLink href={`#section`}>x</ButtonLink>;
  const guarded = (
    <>
      {/* ok: require-isdangerousurl */}
      {!isDangerousUrl(userUrl) && <ButtonLink href={userUrl}>x</ButtonLink>}
      {userUrl && !isDangerousUrl(userUrl) && <ButtonLink href={userUrl}>x</ButtonLink>}
    </>
  );
  return [unsafeAnchor, unsafeButton, literalAnchor, literalButton, fragmentButton, guarded];
}

export function sinks() {
  // ruleid: require-isdangerousurl
  window.open(userUrl, '_blank');
  // ruleid: require-isdangerousurl
  window.location.assign(userUrl);
  // ruleid: require-isdangerousurl
  location.replace(userUrl);
  // ruleid: require-isdangerousurl
  window.location.href = userUrl;
  // ruleid: require-isdangerousurl
  el.href = userUrl;
  // ruleid: require-isdangerousurl
  void navigate(userUrl);
  // ok: require-isdangerousurl
  window.open('https://example.com', '_blank');
  // ok: require-isdangerousurl
  window.location.assign('/arcade');
  // ok: require-isdangerousurl
  void navigate('/arcade');
  // ok: require-isdangerousurl
  el.href = '/about';
  if (!isDangerousUrl(userUrl)) {
    // ok: require-isdangerousurl
    window.open(userUrl, '_blank');
  }
}

export function phones() {
  // ruleid: enforce-cleanphonenumber
  const tel = `tel:${number}`;
  // ruleid: enforce-cleanphonenumber
  const sms = `sms:${number}`;
  // ruleid: enforce-cleanphonenumber
  const smsto = 'smsto:' + number;
  // ok: enforce-cleanphonenumber
  const cleanTel = `tel:${cleanPhoneNumber(number)}`;
  // ok: enforce-cleanphonenumber
  const cleanSms = `sms:${encodeDialString(cleanPhoneNumber(number, true))}`;
  // ok: enforce-cleanphonenumber
  const cleanSmsto = 'smsto:' + cleanPhoneNumber(number, true);
  return [tel, sms, smsto, cleanTel, cleanSms, cleanSmsto];
}
