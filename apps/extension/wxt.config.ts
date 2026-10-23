import { defineConfig } from 'wxt';

// Manifest V3. Permissions follow CLAUDE.md rule 10 exactly:
// required = storage, sidePanel, activeTab, scripting, alarms, offscreen + host play.google.com.
// Everything else is optional and requested in context from the options page.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'sidePanel', 'activeTab', 'scripting', 'alarms', 'offscreen'],
    host_permissions: ['https://play.google.com/*'],
    optional_permissions: ['notifications', 'contextMenus'],
    optional_host_permissions: ['https://*/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // No default_popup: clicking the action opens the side panel (see background.ts).
    action: {
      default_title: '__MSG_actionTitle__',
    },
    commands: {
      'analyse-policy': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdAnalysePolicy__',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
