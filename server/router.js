import { Router } from 'express';

export const apiRouter = Router();

// GET /api/now —— 当前播放 + DJ 状态(施工图 API 契约)
// 占位实现:Phase 3 起由播放队列与 state.db 提供真实数据
apiRouter.get('/now', (req, res) => {
  res.json({
    playing: null,
    queue: [],
    dj: { state: 'idle' },
  });
});
