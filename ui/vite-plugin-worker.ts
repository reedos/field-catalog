import { spawn } from "node:child_process";
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

function runWorker(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const err: Buffer[] = [];
    const child = spawn(cliPath(), ["--library", libraryDir(), ...args], {
      windowsHide: true,
    });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      try {
        resolve(JSON.parse(text));
      } catch {
        const stderr = Buffer.concat(err).toString("utf8").trim();
        reject(new Error(stderr || text || "worker produced no JSON"));
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
