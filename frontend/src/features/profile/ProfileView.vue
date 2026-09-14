<script setup>
// Profile:编辑 user/*.md 语料与 playlists.json —— 改完 DJ 选歌偏好立即变化。
import { ref, onMounted } from 'vue';
import { http } from '../../lib/api/http.js';

const files = ref([]); // {name, content, dirty, saving, saved}
const error = ref(null);

const LABELS = {
  'taste.md': '音乐品味',
  'routines.md': '作息习惯',
  'playlists.json': '歌单',
  'mood-rules.md': '心情规则',
};

async function load() {
  try {
    const res = await http.get('/user/files');
    files.value = res.files.map((f) => ({
      ...f,
      _original: f.content,
      dirty: false,
      saving: false,
      saved: false,
    }));
  } catch (err) {
    error.value = err.message;
  }
}

function touch(f) {
  f.dirty = f.content !== f._original;
  f.saved = false;
}

async function save(f) {
  f.saving = true;
  error.value = null;
  try {
    await http.post('/user/files', { name: f.name, content: f.content });
    f._original = f.content;
    f.dirty = false;
    f.saved = true;
    setTimeout(() => (f.saved = false), 2000);
  } catch (err) {
    error.value = err.message;
  } finally {
    f.saving = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="profile" aria-label="个人资料与语料">
    <header class="head">
      <div>
        <h1 class="title">Profile / 个人档案</h1>
        <p class="sub meta-label">这些语料作为数据注入 DJ 编排 —— 修改后下一次请求即生效</p>
      </div>
      <button class="back" @click="$emit('back')">← 返回电台</button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="files">
      <article v-for="f in files" :key="f.name" class="file">
        <div class="file-head">
          <h2 class="meta-label">{{ f.name }} · {{ LABELS[f.name] || '' }}</h2>
          <span v-if="f.saved" class="saved meta-label">已保存 ✓</span>
        </div>
        <textarea
          v-model="f.content"
          rows="10"
          spellcheck="false"
          :aria-label="`编辑 ${f.name}`"
          @input="touch(f)"
        ></textarea>
        <div class="file-foot">
          <span v-if="f.dirty" class="meta-label">未保存的更改</span>
          <span v-else class="meta-label"></span>
          <button class="btn" :disabled="!f.dirty || f.saving" @click="save(f)">
            {{ f.saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.profile {
  display: grid;
  gap: var(--vr-space-5);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--vr-space-4);
}
.title {
  font-size: var(--vr-text-heading);
  letter-spacing: -0.01em;
}
.sub {
  color: var(--vr-text-muted);
  margin-top: var(--vr-space-1);
}
.back {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  padding: var(--vr-space-2) var(--vr-space-4);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  min-height: 44px;
}
.files {
  display: grid;
  gap: var(--vr-space-4);
}
.file {
  background: var(--vr-panel);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-m);
  padding: var(--vr-space-4);
  display: grid;
  gap: var(--vr-space-3);
}
.file-head {
  display: flex;
  justify-content: space-between;
}
.saved {
  color: var(--vr-on-air);
}
textarea {
  width: 100%;
  background: var(--vr-bg);
  border: 1px solid var(--vr-line);
  border-radius: var(--vr-radius-s);
  color: var(--vr-text);
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-body-sm);
  line-height: 1.6;
  padding: var(--vr-space-3);
  resize: vertical;
}
textarea:focus {
  outline: 2px solid var(--vr-ai);
  outline-offset: -1px;
}
.file-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.btn {
  font-family: var(--vr-font-mono);
  font-size: var(--vr-text-caption);
  padding: var(--vr-space-2) var(--vr-space-4);
  background: var(--vr-on-air);
  color: var(--vr-ink);
  border-radius: var(--vr-radius-s);
  min-height: 44px;
}
.btn:disabled {
  opacity: 0.4;
}
.error {
  color: var(--vr-danger);
}
</style>
