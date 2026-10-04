import type { ToolCopy } from './types';
import { staysInBrowser } from './shared';

/** The how-to steps and FAQs of the wifi-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a WiFi QR Code",
      "description": "Generate a QR code to share your WiFi network instantly.",
      "supply": [
        { "name": "WiFi Network Name (SSID)" },
        { "name": "WiFi Password" },
        { "name": "Encryption Type" }
      ],
      "steps": [
        {
          "name": "Enter Network Name",
          "text": "Input your WiFi SSID (Network Name) into the designated field."
        },
        {
          "name": "Enter Password",
          "text": "Enter your WiFi password. Your data remains local and secure."
        },
        {
          "name": "Select Encryption",
          "text": "Choose your network encryption type (WPA/WPA2 is most common)."
        },
        {
          "name": "Download or Share",
          "text": "Click 'Download' to save the QR code or scan it directly from the screen."
        }
      ]
    },
  faqs: [
    {
      question: 'Which phones can join Wi-Fi from a QR code?',
      answer:
        'Most modern phones can. On iPhone (iOS 11 and later) and on most Android phones (Android 10 and later), point the camera at the code and tap the prompt to join. Older Android phones can use Google Lens or a scanner app.',
    },
    staysInBrowser('my Wi-Fi password'),
    {
      question: 'Can anyone read the password from the QR code?',
      answer:
        'Yes. The password is stored in the code as plain text so that phones can join, and any QR scanner app can display it. Only put the code where you would be happy to share the password, such as inside your home, office or café.',
    },
    {
      question: 'Does it work with hidden networks and WPA3?',
      answer:
        'Yes. Tick "Hidden Network" if your network does not broadcast its name. Choose WPA/WPA2/WPA3 for almost all home and business routers. WEP, WPA2 Enterprise (EAP) and open networks are also supported.',
    },
    {
      question: 'What happens if I change my Wi-Fi password?',
      answer:
        'The old QR code will stop connecting, because the old password is stored inside it. Make a new code with the new password; it only takes a few seconds.',
    },
  ],
};
