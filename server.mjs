import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 51982;
const ROOM_ID_LENGTH = 16;
const ROOM_ID_ATTEMPTS = 8;
const CONFIG_PATH = process.env.COLLAB_CONFIG || path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const port = Number.parseInt(process.env.COLLAB_PORT ?? process.env.PORT ?? '', 10) || DEFAULT_PORT;

const defaultConfig = {
  requireApiKey: false,
  apiKeys: [],
  maxRooms: 100,
};

const normalizeConfig = (raw) => {
  const apiKeys = Array.isArray(raw?.apiKeys)
    ? Array.from(new Set(raw.apiKeys.map((value) => String(value).trim()).filter(Boolean)))
    : [];
  const maxRooms = Number.isFinite(raw?.maxRooms)
    ? Math.max(0, Math.min(10_000, Number(raw.maxRooms)))
    : defaultConfig.maxRooms;
  return {
    requireApiKey: Boolean(raw?.requireApiKey),
    apiKeys,
    maxRooms,
  };
};

const loadConfig = async () => {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return normalizeConfig(JSON.parse(raw));
  } catch {
    const fallback = { ...defaultConfig };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
};

let config = await loadConfig();

const saveConfig = async (next) => {
  config = normalizeConfig(next);
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
};

const jsonResponse = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const contentTypeForPath = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
};

const serveStatic = async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const rawPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = path.normalize(rawPath).replace(/^\.+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypeForPath(filePath) });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (requestUrl.pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
      jsonResponse(res, 200, {
        ...config,
        roomCount: publicRooms.size,
      });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
      const body = await readJsonBody(req);
      if (!body) {
        jsonResponse(res, 400, { error: 'invalid-json' });
        return;
      }
      await saveConfig({
        ...config,
        requireApiKey: Boolean(body.requireApiKey),
        maxRooms: Number.isFinite(body.maxRooms) ? Number(body.maxRooms) : config.maxRooms,
      });
      jsonResponse(res, 200, {
        ...config,
        roomCount: publicRooms.size,
      });
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/api/keys') {
      const body = await readJsonBody(req);
      if (!body || typeof body.action !== 'string') {
        jsonResponse(res, 400, { error: 'invalid-request' });
        return;
      }
      const action = body.action;
      const current = new Set(config.apiKeys);
      if (action === 'add') {
        const provided = typeof body.key === 'string' ? body.key.trim() : '';
        const nextKey = provided || crypto.randomBytes(16).toString('hex');
        current.add(nextKey);
      } else if (action === 'remove') {
        const target = typeof body.key === 'string' ? body.key.trim() : '';
        current.delete(target);
      } else {
        jsonResponse(res, 400, { error: 'unsupported-action' });
        return;
      }
      await saveConfig({
        ...config,
        apiKeys: Array.from(current.values()),
      });
      jsonResponse(res, 200, {
        ...config,
        roomCount: publicRooms.size,
      });
      return;
    }
    jsonResponse(res, 404, { error: 'not-found' });
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

const wss = new WebSocketServer({ server });

const clients = new Map();
const clientsById = new Map();
const networkSockets = new Map();
const lanRoomsByNetwork = new Map();
const publicRooms = new Map();

const normalizeAddress = (address) => {
  if (!address) return '';
  if (address.startsWith('::ffff:')) {
    return address.slice('::ffff:'.length);
  }
  return address;
};

const networkKeyFromAddress = (address) => {
  if (!address) return 'unknown';
  const normalized = normalizeAddress(address);
  if (normalized.includes(':')) {
    const parts = normalized.split(':').filter(Boolean);
    return parts.slice(0, 4).join(':') || normalized;
  }
  const segments = normalized.split('.');
  if (segments.length === 4) {
    return `${segments[0]}.${segments[1]}.${segments[2]}`;
  }
  return normalized;
};

const safeSend = (socket, message) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const getLanRoomMap = (networkKey) => {
  let map = lanRoomsByNetwork.get(networkKey);
  if (!map) {
    map = new Map();
    lanRoomsByNetwork.set(networkKey, map);
  }
  return map;
};

const getLanShareList = (networkKey) => {
  const map = lanRoomsByNetwork.get(networkKey);
  if (!map) return [];
  return Array.from(map.values()).map((room) => room.meta);
};

const broadcastShareList = (networkKey) => {
  const sockets = networkSockets.get(networkKey);
  if (!sockets) return;
  const shares = getLanShareList(networkKey);
  sockets.forEach((socket) => safeSend(socket, { type: 'share:list', shares }));
};

const removePublicRoom = (roomId) => {
  const room = publicRooms.get(roomId);
  if (!room) return;
  room.members.forEach((memberId) => {
    const memberSocket = clientsById.get(memberId);
    if (memberSocket) {
      safeSend(memberSocket, { type: 'room:closed', roomId });
    }
  });
  publicRooms.delete(roomId);
};

const removeLanRoom = (roomId, networkKey) => {
  const map = lanRoomsByNetwork.get(networkKey);
  if (!map) return;
  const room = map.get(roomId);
  if (!room) return;
  room.members.forEach((memberId) => {
    const memberSocket = clientsById.get(memberId);
    if (memberSocket) {
      safeSend(memberSocket, { type: 'room:closed', roomId });
    }
  });
  map.delete(roomId);
  broadcastShareList(networkKey);
};

const handleMemberLeave = (room, roomId, clientId) => {
  if (!room.members.has(clientId)) return;
  room.members.delete(clientId);
  safeSend(room.hostSocket, { type: 'room:member-left', roomId, clientId });
};

const findLanRoom = (roomId, networkKey) => {
  const map = lanRoomsByNetwork.get(networkKey);
  if (!map) return null;
  return map.get(roomId) ?? null;
};

const findRoom = (roomId, networkKey) => {
  const publicRoom = publicRooms.get(roomId);
  if (publicRoom) return { kind: 'public', room: publicRoom };
  const lanRoom = findLanRoom(roomId, networkKey);
  if (lanRoom) return { kind: 'lan', room: lanRoom };
  return null;
};

const findLanRoomsByHostSocket = (socket) => {
  const matches = [];
  lanRoomsByNetwork.forEach((map, networkKey) => {
    map.forEach((room, roomId) => {
      if (room.hostSocket === socket) {
        matches.push({ roomId, networkKey });
      }
    });
  });
  return matches;
};

const findPublicRoomsByHostSocket = (socket) => {
  const matches = [];
  publicRooms.forEach((room, roomId) => {
    if (room.hostSocket === socket) {
      matches.push(roomId);
    }
  });
  return matches;
};

const findRoomsByMember = (clientId) => {
  const matches = [];
  publicRooms.forEach((room, roomId) => {
    if (room.members.has(clientId)) {
      matches.push({ kind: 'public', roomId });
    }
  });
  lanRoomsByNetwork.forEach((map, networkKey) => {
    map.forEach((room, roomId) => {
      if (room.members.has(clientId)) {
        matches.push({ kind: 'lan', roomId, networkKey });
      }
    });
  });
  return matches;
};

const generateRoomId = () => {
  for (let attempt = 0; attempt < ROOM_ID_ATTEMPTS; attempt += 1) {
    const bytes = crypto.randomBytes(ROOM_ID_LENGTH);
    const candidate = Array.from(bytes, (value) => (value % 10).toString()).join('');
    if (!publicRooms.has(candidate)) {
      return candidate;
    }
  }
  return `${Date.now()}`.slice(-ROOM_ID_LENGTH).padStart(ROOM_ID_LENGTH, '0');
};

wss.on('connection', (socket, request) => {
  const remoteAddress = normalizeAddress(request.socket.remoteAddress ?? '');
  const networkKey = networkKeyFromAddress(remoteAddress);
  const sockets = networkSockets.get(networkKey) ?? new Set();
  sockets.add(socket);
  networkSockets.set(networkKey, sockets);

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'hello': {
        const clientId = String(message.clientId ?? '');
        if (!clientId) return;
        const nickname = typeof message.nickname === 'string' ? message.nickname : '';
        const avatar = typeof message.avatar === 'string' ? message.avatar : undefined;
        clients.set(socket, { clientId, nickname, avatar, networkKey });
        clientsById.set(clientId, socket);
        safeSend(socket, { type: 'share:list', shares: getLanShareList(networkKey) });
        return;
      }
      case 'profile:update': {
        const clientId = String(message.clientId ?? '');
        const record = clients.get(socket);
        if (!record || record.clientId !== clientId) return;
        const nickname = typeof message.nickname === 'string' ? message.nickname : record.nickname;
        const avatar = typeof message.avatar === 'string' ? message.avatar : record.avatar;
        clients.set(socket, { ...record, nickname, avatar });
        return;
      }
      case 'share:announce': {
        const roomId = String(message.roomId ?? '');
        const hostId = String(message.hostId ?? '');
        if (!roomId || !hostId) return;
        const meta = {
          roomId,
          hostId,
          projectId: String(message.projectId ?? ''),
          name: String(message.name ?? ''),
          appVersion: String(message.appVersion ?? ''),
          requiresPassword: Boolean(message.requiresPassword),
          ownerNickname: String(message.ownerNickname ?? ''),
          permission: message.permission === 'viewer' ? 'viewer' : 'editor',
          visibility: message.visibility === 'private' ? 'private' : 'public',
          address: remoteAddress || String(message.address ?? ''),
          updatedAt: Date.now(),
        };
        const map = getLanRoomMap(networkKey);
        const existing = map.get(roomId);
        map.set(roomId, {
          hostId,
          hostSocket: socket,
          meta,
          members: existing?.members ?? new Set(),
        });
        broadcastShareList(networkKey);
        return;
      }
      case 'share:remove': {
        const roomId = String(message.roomId ?? '');
        if (!roomId) return;
        const publicRoom = publicRooms.get(roomId);
        if (publicRoom && publicRoom.hostSocket === socket) {
          removePublicRoom(roomId);
          return;
        }
        const lanRoom = findLanRoom(roomId, networkKey);
        if (lanRoom && lanRoom.hostSocket === socket) {
          removeLanRoom(roomId, networkKey);
        }
        return;
      }
      case 'room:create': {
        const clientId = String(message.clientId ?? '');
        const record = clients.get(socket);
        if (!record || record.clientId !== clientId) return;
        if (config.requireApiKey) {
          const apiKey = typeof message.apiKey === 'string' ? message.apiKey.trim() : '';
          if (!apiKey || !config.apiKeys.includes(apiKey)) {
            safeSend(socket, { type: 'room:error', reason: 'api_key_required', message: 'API key required' });
            return;
          }
        }
        if (config.maxRooms > 0 && publicRooms.size >= config.maxRooms) {
          safeSend(socket, { type: 'room:error', reason: 'room_limit', message: 'Room limit reached' });
          return;
        }
        const roomId = generateRoomId();
        const permission = message.permission === 'viewer' ? 'viewer' : 'editor';
        const visibility = message.visibility === 'private' ? 'private' : 'public';
        const meta = {
          roomId,
          name: String(message.name ?? ''),
          requiresPassword: Boolean(message.requiresPassword),
          permission,
          visibility,
          appVersion: String(message.appVersion ?? ''),
        };
        publicRooms.set(roomId, {
          hostId: clientId,
          hostSocket: socket,
          meta,
          members: new Set(),
        });
        safeSend(socket, { type: 'room:created', roomId });
        return;
      }
      case 'room:list': {
        const query = typeof message.query === 'string' ? message.query.trim() : '';
        const rooms = Array.from(publicRooms.values())
          .filter((room) => {
            if (!query) {
              return room.meta.visibility !== 'private';
            }
            const matches = room.meta.roomId?.includes(query) || room.meta.roomId === query;
            if (!matches) return false;
            if (room.meta.visibility !== 'private') return true;
            return room.meta.roomId === query;
          })
          .map((room) => ({
            roomId: room.meta.roomId,
            name: room.meta.name,
            requiresPassword: room.meta.requiresPassword,
            permission: room.meta.permission,
            visibility: room.meta.visibility,
            appVersion: room.meta.appVersion,
          }));
        safeSend(socket, { type: 'room:list', rooms, query });
        return;
      }
      case 'join:request': {
        const roomId = String(message.roomId ?? '');
        const clientId = String(message.clientId ?? '');
        if (!roomId || !clientId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved) {
          safeSend(socket, { type: 'join:denied', roomId, reason: 'not_found' });
          return;
        }
        safeSend(resolved.room.hostSocket, {
          type: 'join:request',
          roomId,
          clientId,
          nickname: String(message.nickname ?? ''),
          avatar: typeof message.avatar === 'string' ? message.avatar : undefined,
          password: typeof message.password === 'string' ? message.password : undefined,
          requestId: String(message.requestId ?? ''),
        });
        return;
      }
      case 'join:approve': {
        const roomId = String(message.roomId ?? '');
        const clientId = String(message.clientId ?? '');
        if (!roomId || !clientId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved || resolved.room.hostSocket !== socket) return;
        resolved.room.members.add(clientId);
        const memberSocket = clientsById.get(clientId);
        if (memberSocket) {
          safeSend(memberSocket, {
            type: 'join:approved',
            roomId,
            hostId: resolved.room.hostId,
            permission: String(message.permission ?? 'editor'),
          });
        }
        return;
      }
      case 'join:deny': {
        const roomId = String(message.roomId ?? '');
        const clientId = String(message.clientId ?? '');
        if (!roomId || !clientId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved || resolved.room.hostSocket !== socket) return;
        const memberSocket = clientsById.get(clientId);
        if (memberSocket) {
          safeSend(memberSocket, {
            type: 'join:denied',
            roomId,
            reason: String(message.reason ?? ''),
          });
        }
        return;
      }
      case 'client:message': {
        const roomId = String(message.roomId ?? '');
        if (!roomId) return;
        const resolved = findRoom(roomId, networkKey);
        const client = clients.get(socket);
        if (!resolved || !client) return;
        safeSend(resolved.room.hostSocket, {
          type: 'client:message',
          roomId,
          clientId: client.clientId,
          payload: message.payload,
        });
        return;
      }
      case 'room:message': {
        const roomId = String(message.roomId ?? '');
        if (!roomId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved || resolved.room.hostSocket !== socket) return;
        const targetId = typeof message.targetId === 'string' ? message.targetId : null;
        if (targetId) {
          const targetSocket = clientsById.get(targetId);
          if (targetSocket) {
            safeSend(targetSocket, { type: 'room:message', roomId, payload: message.payload });
          }
          return;
        }
        resolved.room.members.forEach((memberId) => {
          const memberSocket = clientsById.get(memberId);
          if (memberSocket) {
            safeSend(memberSocket, { type: 'room:message', roomId, payload: message.payload });
          }
        });
        return;
      }
      case 'room:leave': {
        const roomId = String(message.roomId ?? '');
        const clientId = String(message.clientId ?? '');
        if (!roomId || !clientId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved) return;
        handleMemberLeave(resolved.room, roomId, clientId);
        return;
      }
      case 'room:close': {
        const roomId = String(message.roomId ?? '');
        if (!roomId) return;
        const resolved = findRoom(roomId, networkKey);
        if (!resolved || resolved.room.hostSocket !== socket) return;
        if (resolved.kind === 'public') {
          removePublicRoom(roomId);
        } else {
          removeLanRoom(roomId, networkKey);
        }
        return;
      }
      default:
        return;
    }
  });

  socket.on('close', () => {
    const record = clients.get(socket);
    if (record) {
      clients.delete(socket);
      if (clientsById.get(record.clientId) === socket) {
        clientsById.delete(record.clientId);
      }
      const roomsWithMember = findRoomsByMember(record.clientId);
      roomsWithMember.forEach((entry) => {
        const resolved = findRoom(entry.roomId, networkKey);
        if (!resolved) return;
        handleMemberLeave(resolved.room, entry.roomId, record.clientId);
      });
    }

    const lanRooms = findLanRoomsByHostSocket(socket);
    lanRooms.forEach(({ roomId, networkKey: roomNetwork }) => {
      removeLanRoom(roomId, roomNetwork);
    });

    const publicHostRooms = findPublicRoomsByHostSocket(socket);
    publicHostRooms.forEach((roomId) => removePublicRoom(roomId));

    const networkSet = networkSockets.get(networkKey);
    if (networkSet) {
      networkSet.delete(socket);
      if (networkSet.size === 0) {
        networkSockets.delete(networkKey);
      }
    }
  });
});

server.listen(port, () => {
  console.log(`[collab] server listening on :${port}`);
});
