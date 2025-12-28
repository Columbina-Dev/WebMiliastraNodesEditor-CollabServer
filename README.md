# [简体中文](README.md) | [English](README_EN.md)

# 《原神·千星奇域》节点图模拟器联机编辑服务器

一个用于《原神·千星奇域》节点图模拟器联机编辑功能的轻量级的WebSocket信令服务器

> [!WARNING]  
> 该项目90%以上代码均由AI生成。

## 快速上手

```bash
git clone https://github.com/Columbina-Dev/WebMiliastraNodesEditor-CollabServer.git
cd WebMiliastraNodesEditor-CollabServer/
npm install
npm start
```

- 默认管理员网页界面: `http://localhost:51982`
- WebSocket端点: `ws://<host>:51982`

## 配置

使用管理员网页界面进行配置：
- 是否需要API密钥来创建房间
- 可用的API密钥列表
- 服务器内最大房间数量

设置将保存在`config.json`

## Docker

```bash
docker build -t miliastra-collab-server .
docker run -p 51982:51982 -v /path/to/config.json:/app/config.json miliastra-collab-server
```

## 环境变量

- `PORT` 或 `COLLAB_PORT`: 覆盖监听端口
- `COLLAB_CONFIG`: 配置文件路径

## 注意事项

- 使用HTTPS时，需通过`wss://`开放服务器，并使用反向代理或隧道（Cloudflared、Nginx、Caddy）
- 与 [主项目](https://github.com/Columbina-Dev/WebMiliastraNodesEditor) 相同，此服务器项目同样采用GPLv3许可证。
