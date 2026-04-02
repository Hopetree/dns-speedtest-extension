# DNS Speed Test 浏览器插件

## 功能
- 通过 AliDNS、DNSPod（腾讯）、Cloudflare、Google 四个服务查询域名的所有IP
- 自动测试每个IP的访问延迟
- 标记最快IP，一键复制 hosts 配置

## 安装方法

### Chrome / Edge / Brave
1. 打开浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本文件夹（`dns-speedtest-extension`）
5. 插件栏出现 ⚡ 图标即安装成功

## 使用方法
1. 点击浏览器工具栏的 ⚡ 图标
2. 输入域名（如 `github.com`），点击「查询」
3. 等待DNS查询和测速完成
4. 点击最快IP旁的「复制」，或点击「复制最快IP」获取hosts配置

## 添加到 hosts 文件

### Windows
编辑 `C:\Windows\System32\drivers\etc\hosts`

### macOS / Linux
编辑 `/etc/hosts`

添加格式：
```
1.2.3.4  github.com
```

## 注意事项
- 测速基于 HTTPS/HTTP 连接时间，受网络波动影响
- 部分IP可能因跨域限制显示超时，但实际可能可达
- 建议同时测试多次取最稳定的IP
