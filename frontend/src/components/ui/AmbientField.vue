<script setup>
// 环境场:极低对比度的点阵星尘,canvas 绘制,缓慢漂移。
// 唯一持续动效之一;reduced-motion 下渲染一帧静止点阵。
import { onMounted, onBeforeUnmount, ref } from 'vue';

const canvas = ref(null);
let raf = 0;
let ro = null;
let stars = [];
let reduce = false;

onMounted(() => {
  reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.value.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas.value;
    canvas.value.width = w * dpr;
    canvas.value.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed(w, h);
    if (reduce) draw();
  }
  function seed(w, h) {
    const count = Math.round((w * h) / 16000); // 极稀疏
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.2 + 0.4,
      vx: (Math.random() - 0.5) * 0.06,
      vy: (Math.random() - 0.5) * 0.04,
      a: Math.random() * 0.25 + 0.08,
      tw: Math.random() * Math.PI * 2,
    }));
  }
  function draw() {
    const w = canvas.value.clientWidth;
    const h = canvas.value.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      if (!reduce) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x = w;
        if (s.x > w) s.x = 0;
        if (s.y < 0) s.y = h;
        if (s.y > h) s.y = 0;
      }
      const twinkle = reduce ? 1 : 0.65 + 0.35 * Math.sin(s.tw);
      ctx.beginPath();
      ctx.fillStyle = `rgba(210, 225, 220, ${s.a * twinkle})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduce) raf = requestAnimationFrame(draw);
  }

  ro = new ResizeObserver(resize);
  ro.observe(canvas.value);
  resize();
  if (!reduce) raf = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
</script>

<template>
  <canvas ref="canvas" class="ambient" aria-hidden="true"></canvas>
</template>

<style scoped>
.ambient {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
