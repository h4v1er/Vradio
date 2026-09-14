import { createApp } from 'vue';

// Nothing 设计语言字体(自托管,无 CDN 依赖)
import '@fontsource/space-grotesk/300.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/doto/400.css';
import '@fontsource/doto/700.css';

import './styles/tokens.css';
import './styles/global.css';
import App from './App.vue';
import { initChat } from './stores/chat.js';

initChat();

createApp(App).mount('#app');
