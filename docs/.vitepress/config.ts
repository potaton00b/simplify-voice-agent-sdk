import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'voice-agent-sdk',
  description: 'Lightweight TypeScript SDK for building Twilio voice agents with swappable STT and TTS providers.',
  base: '/simplify-voice-agent-sdk/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/potaton00b/simplify-voice-agent-sdk' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Providers', link: '/guide/providers' },
          { text: 'Custom Adapters', link: '/guide/custom-adapters' },
          { text: 'DTMF Behavior', link: '/guide/dtmf' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api/' },
        ],
      },
    ],

    search: { provider: 'local' },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/potaton00b/simplify-voice-agent-sdk' },
    ],

    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
