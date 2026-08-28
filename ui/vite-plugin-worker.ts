import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function libraryDir(): string {
  return path.join(os.homedir(), "FieldCatalog");
}

function cliPath(): string {
  const win = path.join(root, ".venv", "Scripts", "fieldcatalog.exe");
  if (fs.existsSync(win)) return win;
  const unix = path.join(root, ".venv", "bin", "fieldcatalog");
  if (fs.existsSync(unix)) return unix;
  return "fieldcatalog";
}

function inside(rootDir: string, target: string): boolean {
  const rel = path.relative(path.resolve(rootDir), path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// --- persistent serve child, mirroring the Rust side ------------------------
// One `fieldcatalog serve` process for the whole dev session; each request is a
// JSON line matched to its response by id. Dies? The next request respawns it.

type ServeChild = ChildProcessByStdio<Writable, Readable, Readable>;

let serveChild: ServeChild | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureServe(): ServeChild {
  if (serveChild && serveChild.exitCode === null) return serveChild;
  const child = spawn(cliPath(), ["--library", libraryDir(), "serve"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let id: number | undefined;
    try {
      id = JSON.parse(line).id;
    } catch {
      return;
    }
    const waiter = typeof id === "number" ? pending.get(id) : undefined;
    if (waiter) {
      pending.delete(id!);
      waiter.resolve(JSON.parse(line));
    }
  });
  // Progress lines; the browser has no event channel, so just log them.
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    if (line.trim()) console.log(`[fieldcatalog] ${line}`);
  });
  child.on("exit", () => {
    for (const [, waiter] of pending) waiter.reject(new Error("serve worker exited"));
    pending.clear();
    serveChild = null;
  });
  serveChild = child;
  return child;
}

function runWorker(args: string[]): Promise<unknown> {
  const child = ensureServe();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("serve worker timed out"));
    }, 600_000);
    const settle = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer);
      fn(v);
    };
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
    child.stdin.write(JSON.stringify({ id, args }) + "\n", (err) => {
      if (err && pending.delete(id)) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function pathnameOf(req: IncomingMessage): string {
  return (req.url || "").split("?")[0];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const body: Buffer[] = [];
    req.on("data", (c) => body.push(c));
    req.on("end", () => resolve(Buffer.concat(body).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

export function workerPlugin(): Plugin {
  return {
    name: "fieldcatalog-worker",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = pathnameOf(req);
        if (pathname === "/api/paths") {
          sendJson(res, 200, { cli: cliPath(), library: libraryDir() });
          return;
        }
        if (pathname === "/api/worker") {
          if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "POST only" });
            return;
          }
          void readBody(req)
            .then((raw) => {
              const args: string[] = JSON.parse(raw).args ?? [];
              return runWorker(args);
            })
            .then((json) => sendJson(res, 200, json))
            .catch((e: Error) => sendJson(res, 500, { ok: false, error: e.message }));
          return;
        }
        if (pathname === "/api/file") {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const filePath = url.searchParams.get("path") || "";
          if (!filePath || !inside(libraryDir(), filePath) || !fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end("not found");
            return;
          }
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=3600");
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });
    },
  };
}
