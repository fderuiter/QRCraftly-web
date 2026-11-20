import type { ToolCopy } from './types';

/** The how-to steps and FAQs of the wifi-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a WiFi QR Code',
    description: 'Share your Wi-Fi network with a code guests can scan.',
    supply: [{ name: 'WiFi Network Name (SSID)' }, { name: 'WiFi Password' }, { name: 'Encryption Type' }],
    steps: [
      { name: 'Enter the network name', text: 'Type the name exactly as your router shows it.' },
      { name: 'Enter the password', text: 'Leave it empty for an open network.' },
      { name: 'Pick the security type', text: 'Choose WPA / WPA2 / WPA3 for most routers, or WPA3 only (SAE) only for strict WPA3-only networks.' },
      { name: 'Download it', text: 'Save the code, or let guests scan it straight from your screen.' },
    ],
  },
  faqs: [
    {
      question: 'Which phones can join Wi-Fi from a QR code?',
      answer:
        'iPhones on iOS 11 or later and most Android phones on Android 10 or later: point the camera at the code and tap the prompt. Older Android phones can use Google Lens or a scanner app.',
    },
    {
      question: 'Can anyone read the password from the QR code?',
      answer:
        'Yes. The password is in the code as plain text so phones can join, and any scanner app can show it. Only put the code where you would share the password anyway.',
    },
    {
      question: 'Does it work with hidden networks and WPA3?',
      answer:
        'Yes. Turn on Hidden Network if your router hides its SSID, and choose WPA / WPA2 / WPA3 for almost every home or office router, including mixed WPA2/WPA3 routers. Pick WPA3 only (SAE) only when your router is set to WPA3 only: Android phones read it, while iPhone cameras may not. WEP, WPA2 Enterprise (EAP), and None (Open Network) are supported too.',
    },
    {
      question: 'What happens if I change my Wi-Fi password?',
      answer:
        'The old code stops working, because the old password is inside it. Make a new code with the new password.',
    },
  ],
};
