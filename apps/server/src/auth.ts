import type { NextFunction, Request, Response } from "express";
import type { JsonStore } from "./store.js";

export type AuthContext = {
  token?: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function authMiddleware(store: JsonStore, authDisabled: boolean) {
  return async (request: Request, response: Response, next: NextFunction) => {
    if (authDisabled) {
      request.auth = {};
      next();
      return;
    }

    const token = extractBearerToken(request.header("authorization"));
    if (!token || !(await store.verifyToken(token))) {
      response.status(401).json({ error: "未登录或登录已失效。" });
      return;
    }

    request.auth = { token };
    next();
  };
}

export async function verifyWsToken(store: JsonStore, token: string | null, authDisabled: boolean) {
  if (authDisabled) {
    return true;
  }

  return !!token && (await store.verifyToken(token));
}

export function extractBearerToken(header?: string): string | undefined {
  if (!header) {
    return undefined;
  }

  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}
