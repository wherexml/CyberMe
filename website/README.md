# CyberMe 官网

独立静态官网，视觉参考 Voice Input v3。与桌面应用、业务数据、连接授权和私有分发完全隔离。

## 实现前记录的失败面

- 打包时误收私有安装包、下载 URL、凭据、业务截图，或误把 Voicemore 的发布地址、品牌和产品数据带到官网。
- 官网链接指向其他站点、错误环境或虚假的下载动作。未知路径回退到首页，掩盖下载或资源不存在。
- 桌面横向展示卡在中途、跳转锚点偏移；窄屏裁掉演示内容；键盘操作把焦点送进不可见区域；减少动态或关闭脚本时丢内容。
- 语言切换丢失所在章节；手机菜单无法关闭；FAQ 不可访问。
- Pages 名称已占用、把预览误作正式部署，或下载路径意外暴露。正式的 Pages 域名通过复验后，才解绑此前由本站创建的 Worker 自定义域；不改其他 DNS 记录。

## 页面与发布

- `page.html` 与 `generate.py` 是三种语言页面的源。运行 `python3 website/generate.py` 刷新 HTML 和现有品牌图标。
- 发布目录固定为 `public/`。Cloudflare Pages 项目 `cyberme` 的生产分支为 `main`，只使用默认域名 [cyberme.pages.dev](https://cyberme.pages.dev/)。未知路径返回 404。
- 「私有测试」是页面锚点。需要开放分发时，另行接入经过授权的下载入口；不要把私有 URL、包体或凭据放入 `public/`。

## 复验

从项目根目录运行：

```sh
python3 website/generate.py
(cd website && npx --yes wrangler@4.151.1 pages dev public --ip 127.0.0.1 --port 46880)
```

在另一个终端运行（将 `URL` 换成线上域名即可复验部署）：

```sh
URL=http://127.0.0.1:46880
OUTPUT="$PWD/output/cyberme-website-20261109/local"
mkdir -p "$OUTPUT"
python3 website/http-e2e.py "$URL" > "$OUTPUT/http-results.json"
{ printf 'const base = "%s"; const out = "%s";\n' "$URL" "$OUTPUT"; cat website/browser-e2e.mjs; } | ego-browser nodejs
```

HTTP 检查逐项校验部署文件字节和响应头，以及下载、源码、业务 API 和未知路径的 404。浏览器脚本输出检查结果与截图 URL。页面使用合成演示数据，验收范围为官网，未验证桌面应用功能或私有安装分发。

官网采用 Cloudflare Pages Direct Upload。GitHub 保存源码。经授权发布时，从 `website/` 运行 `npx --yes wrangler@4.151.1 pages deploy public --project-name cyberme --branch main`，再对默认域名执行 HTTP 与浏览器复验。
