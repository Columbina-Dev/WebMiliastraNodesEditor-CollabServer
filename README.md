# Miliastra Collaboration Server

A lightweight WebSocket signaling server for Miliastra collaborative editing.

## Quick Start

```bash
cd /root/CollabServer
npm install
npm start
```

- Default admin UI: `http://localhost:51982`
- WebSocket endpoint: `ws://<host>:51982`

## Configuration

Use the admin UI to configure:
- Require API keys for room creation
- Active API key list
- Maximum number of rooms

Settings are persisted to `config.json`.

## Docker

```bash
docker build -t miliastra-collab-server .
docker run -p 51982:51982 -v /path/to/config.json:/app/config.json miliastra-collab-server
```

## Environment Variables

- `PORT` or `COLLAB_PORT`: Override the listening port
- `COLLAB_CONFIG`: Path to the config file

## Notes

Expose the server via `wss://` when using HTTPS. Reverse proxies or tunnels (Cloudflared, Nginx, Caddy) work well.
