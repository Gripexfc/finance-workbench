# 财务工作台 · 离线销售版

这是本地离线版本。macOS 双击 `start-finance-workbench.command`，Windows 双击 `start-finance-workbench.bat` 即可启动本地页面。

- 首次使用免费 7 天。
- 到期后在“授权与设置”中粘贴授权方发来的离线签名授权码。
- 不需要联网，不需要提供设备 ID。
- 授权方续费时生成新的授权码，用户直接重新粘贴。
- 启动器只绑定 `127.0.0.1`，业务数据保存在本机浏览器。

启动器依赖本机已有的 Node.js 或 Python 3。若要做到完全免安装、并提高源码保护，需要按 macOS/Windows 分别构建 Tauri 或 Electron 桌面应用；本销售包是源码可见的本地网页版本，不能宣传为不可破解的加密程序。
