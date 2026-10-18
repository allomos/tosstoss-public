**结果.** 投桃部署在 Cloudflare Workers 上，用公网 https 网址打开即可使用：同一网络（同一公网 IP）的设备自动互相看到；输入或打开同一个房间码链接的设备，跨网络也能互相看到并传文件。

**完成标准.**
- `wrangler dev` 本地运行时，现有的发现、改名、传输、大文件测试全部通过（指向 Worker 的地址）。
- 部署后的网址上，两台设备（同一 Wi-Fi）互相出现并传完一个文件；一台手机用流量、一台电脑用 Wi-Fi，用同一房间码互相出现并传完一个文件。
- 局域网 `npm start` 的用法照旧可用。

**备注.**
- 方案（2026-10-18 与使用者确认）：按公网 IP 分组 + 房间码两种都要；按 Cloudflare 免费套餐设计。
- Worker + Durable Object（WebSocket hibernation）替代 server.js 做在线列表和分块中转；静态页面用 Workers Assets。
- 部署需要使用者登录自己的 Cloudflare 账号（`wrangler login`），这一步有外部影响，等使用者操作。
