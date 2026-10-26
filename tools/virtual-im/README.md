# Virtual IM

```sh
node tools/virtual-im/server.mjs
```

打开 http://127.0.0.1:46520/ 。默认每 20 秒收到一条模拟工作消息。可选择 60/20/5 秒、暂停、手动来信、综合/协作/突发场景。

支持搜索、未读、独立草稿、回复及模拟跟进、审批、稍后/完成/重新打开和 JSON 导出。数据在 `.local/virtual-im/default/`，不连接真实飞书或 OpsTwins 收件箱。关闭浏览器仍来信，停止 Node 服务才停止后台生成。

新工作区：`VIRTUAL_IM_SCOPE=another VIRTUAL_IM_PORT=46523 node tools/virtual-im/server.mjs`。不要让两个实例使用同一 scope。

详见 [规格](../../docs/spec/virtual-im.md) 和 [验收旅程](../../docs/journeys/virtual-im-20261019.md)。
