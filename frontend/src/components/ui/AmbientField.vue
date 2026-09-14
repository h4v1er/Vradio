<script setup>
// 环境场:固定在页面最底层的三层氛围(far 点阵网格 / mid 模糊星云 / near 星点)。
// 性能约定:
//  1. 固定定位 + pointer-events:none,不参与布局;
//  2. 滚动监听用 requestAnimationFrame 合并,每帧至多写一次 CSS 变量,不做布局计算;
//  3. 三层以不同速率视差:星点 0.08 / 星云 0.16 / 网格 0.03(星点在 JS 内偏移卷绕,无缝);
//  4. 鼠标移动让背景重心最多平滑偏移 12px(lerp 逼近),按钮与正文不跟随;
//  5. 只动 transform / opacity / canvas 绘制,无 filter 动画;
//  6. prefers-reduced-motion:不监听、不漂移,渲染一帧静止点阵。
import { onMounted, onBeforeUnmount, ref } from 'vue';

const rootEl = ref(null);
const canvasEl = ref(null);

let raf = 0;
let ro = null;
let stars = [];
let reduce = false;
let last = performance.now();

// 由 scroll(合并)与 pointermove 维护,绘制循环消费
let scrollY = window.scrollY;
let mx = 0; // 当前鼠标偏移(lerp 后)
let my = 0;
let tx = 0; // 目标偏移(视口中心为原点,±12px)
let ty = 0;
let lastVars = ''; // 防重复写 CSS 变量
let onScroll = null;
let onPointer = null;

onMounted(() => {
  reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = canvasEl.value;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function seed(w, h) {
    const count = Math.min(180, Math.round((w * h) / 12000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.1 + 0.3,
      vx: (Math.random() - 0.5) * 0.05,
      vy: -(0.01 + Math.random() * 0.05),
      a: Math.random() * 0.22 + 0.06,
      tw: Math.random() * Math.PI * 2,
      tws: 0.2 + Math.random() * 0.6,
    }));
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed(w, h);
    if (reduce) draw();
  }

  function writeVars() {
    // 每帧至多一次 style 写;值未变不写,避免无效样式重算
    const vars = `${Math.round(scrollY)}|${mx.toFixed(2)}|${my.toFixed(2)}`;
    if (vars === lastVars) return;
    lastVars = vars;
    rootEl.value.style.setProperty('--scroll-y', Math.round(scrollY));
    rootEl.value.style.setProperty('--amb-mx', `${mx.toFixed(2)}px`);
    rootEl.value.style.setProperty('--amb-my', `${my.toFixed(2)}px`);
  }

  function draw(now = performance.now()) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (!reduce) {
      // 鼠标重心平滑逼近(0.05 lerp),不跳变
      mx += (tx - mx) * 0.05;
      my += (ty - my) * 0.05;
      writeVars();
    }

    // 星点视差 0.08 + 鼠标 0.4;对高度取模卷绕,任意滚动位置无缝
    const offY = (scrollY * 0.08 + my * 0.4) % h;
    const offX = mx * 0.4;
    const t = now / 1000;

    for (const s of stars) {
      if (!reduce) {
        s.x += s.vx * dt * 36; // 极慢漂移
        s.y += s.vy * dt * 36;
        s.tw += s.tws * dt;
      }
      const x = (((s.x + offX) % w) + w) % w;
      const y = (((s.y + offY) % h) + h) % h;
      const twinkle = reduce ? 1 : 0.55 + 0.45 * Math.sin(s.tw);
      ctx.beginPath();
      ctx.fillStyle = `rgba(205, 214, 255, ${(s.a * twinkle).toFixed(3)})`;
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduce) raf = requestAnimationFrame(draw);
  }

  // 滚动:只读一次 scrollY,交由 rAF 帧统一消费;passive,无布局计算
  onScroll = () => {
    scrollY = window.scrollY;
  };
  onPointer = (e) => {
    tx = (e.clientX / window.innerWidth - 0.5) * 2 * 12;
    ty = (e.clientY / window.innerHeight - 0.5) * 2 * 12;
  };

  if (!reduce) {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    raf = requestAnimationFrame(draw);
  }

  ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  if (!reduce) {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pointermove', onPointer);
  }
});
</script>

<template>
  <div ref="rootEl" class="ambient" aria-hidden="true">
    <!-- 中景:模糊星云(视差 0.16) -->
    <div class="layer nebula">
      <span class="blob b1"></span>
      <span class="blob b2"></span>
      <span class="blob b3"></span>
    </div>
    <!-- 远层:极淡点阵网格(视差 0.03) -->
    <div class="layer grid"></div>
    <!-- 近层:星点(视差 0.08,JS 内偏移) -->
    <canvas ref="canvasEl" class="layer stars"></canvas>
  </div>
</template>

<style scoped>
.ambient {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 50% -10%, #0a1030 0%, transparent 55%),
    var(--vr-bg);
}
.layer {
  position: absolute;
}

/* ── 中景:模糊星云 ── */
.nebula {
  /* 溢出留足视差余量 */
  inset: -25%;
  filter: blur(70px); /* 静态模糊一次,不参与动画 */
  transform: translate3d(
    calc(var(--amb-mx, 0px) * 1),
    calc(var(--amb-my, 0px) * 1 + var(--scroll-y, 0) * 0.16px),
    0
  );
}
.blob {
  position: absolute;
  border-radius: 50%;
  opacity: 0.5;
}
.b1 {
  width: 70vw;
  height: 70vw;
  left: -18vw;
  top: -22vw;
  background: radial-gradient(circle at 35% 35%, var(--vr-nebula-indigo), transparent 65%);
  animation: drift-a 90s var(--vr-ease) infinite alternate;
}
.b2 {
  width: 60vw;
  height: 60vw;
  right: -20vw;
  top: 6vh;
  background: radial-gradient(circle at 50% 50%, var(--vr-nebula-violet), transparent 62%);
  animation: drift-b 110s var(--vr-ease) infinite alternate;
}
.b3 {
  width: 80vw;
  height: 80vw;
  left: 12vw;
  bottom: -46vw;
  opacity: 0.65;
  background: radial-gradient(circle at 50% 40%, var(--vr-nebula-deep), transparent 60%);
  animation: drift-a 140s var(--vr-ease) infinite alternate-reverse;
}
@keyframes drift-a {
  to {
    transform: translate3d(36px, -28px, 0);
  }
}
@keyframes drift-b {
  to {
    transform: translate3d(-42px, 24px, 0);
  }
}

/* ── 远层:极淡点阵网格 ── */
.grid {
  inset: -240px;
  background-image: radial-gradient(rgba(148, 163, 210, 0.05) 1px, transparent 1.4px);
  background-size: 28px 28px;
  transform: translate3d(
    calc(var(--amb-mx, 0px) * 0.25),
    calc(var(--amb-my, 0px) * 0.25 + var(--scroll-y, 0) * 0.03px),
    0
  );
}

/* ── 近层:星点 ── */
.stars {
  inset: 0;
  width: 100%;
  height: 100%;
}

/* 动效偏好:星云漂移停止(星点/视差/鼠标由 JS 侧整体停用) */
@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
}
</style>
