import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const PYTHON_API_PORT = Number(process.env.PYTHON_API_PORT || 5000);

let pythonProc: ChildProcess | null = null;

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: 800 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensurePythonBackend(): Promise<void> {
  if (await isPortListening(PYTHON_API_PORT)) {
    return;
  }

  pythonProc = spawn('python3', [path.join(__dirname, 'server.py')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PYTHON_API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProc.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[python-api] ${chunk.toString()}`);
  });
  pythonProc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[python-api] ${chunk.toString()}`);
  });

  for (let i = 0; i < 30; i += 1) {
    if (await isPortListening(PYTHON_API_PORT)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function startServer(): Promise<void> {
  await ensurePythonBackend();

  const app = express();

  // Proxy all /api/* requests to Python 3 SQLite micro-server on port 5000
  app.use('/api', (req, res) => {
    const targetPath = req.originalUrl;
    const proxyReq = http.request(
      {
        host: '127.0.0.1',
        port: PYTHON_API_PORT,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${PYTHON_API_PORT}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `Python backend unreachable: ${err.message}` });
      }
    });

    req.pipe(proxyReq, { end: true });
  });

  const distDir = path.join(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CineVault Gateway running on http://localhost:${PORT} -> Python API :${PYTHON_API_PORT}`);
  });

  const cleanup = () => {
    server.close();
    if (pythonProc && !pythonProc.killed) {
      pythonProc.kill('SIGTERM');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startServer().catch((err) => {
  console.error('Failed to start CineVault server:', err);
  process.exit(1);
});
