const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Storage Methods
  invoke: (channel, data) => {
    let validChannels = [
        'db:get', 'db:set', 'db:clear', 
        'app:quit', 'auth:login', 'auth:logout', 
        'net:resolve-dns',
        'file:save-image', 'file:read-image',
        'db:messages-by-conversation', 'db:message-upsert',
        'db:conversation-update-last', 'db:conversation-create',
        'db:conversation-mark-read', 'db:convo-delete-by-participant'
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
  },
  // Event Listeners (Main -> Renderer)
  on: (channel, func) => {
    let validChannels = ['menu:preferences'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});