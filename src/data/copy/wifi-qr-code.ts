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
      { name: 'Pick the security type', text: 'WPA/WPA2/WPA3 fits almost every router.' },
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
        'Yes. Tick Hidden Network if your router does not broadcast its name, and choose WPA/WPA2/WPA3 for almost any home or office router. WEP, WPA2 Enterprise (EAP) and open networks are there too.',
    },
    {
      question: 'What happens if I change my Wi-Fi password?',
      answer:
        'The old code stops working, because the old password is inside it. Make a new code with the new password.',
    },
  ],
};
