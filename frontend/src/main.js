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

const app = createApp(App);

// v-reveal:区块进入视口时从下方 12px 淡入;
// .near 在视口内持续存在,供区块做微光增强,离开即恢复(配合 global.css)。
app.directive('reveal', {
  mounted(el) {
    el.classList.add('reveal');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('in-view');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          el.classList.toggle('near', entry.isIntersecting);
          if (entry.isIntersecting) el.classList.add('in-view');
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    el._revealIo = io;
  },
  unmounted(el) {
    el._revealIo?.disconnect();
  },
});

app.mount('#app');
