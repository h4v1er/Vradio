// 视图状态:Player / Queue / Profile / Settings(轻量切换,不引路由)
import { reactive } from 'vue';

export const ui = reactive({
  view: 'player', // player | queue | profile | settings
});

export function setView(v) {
  ui.view = v;
}
