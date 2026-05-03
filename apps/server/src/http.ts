import type { Request } from "express";
import type { ServerConfig } from "./config.js";

export function requestServerUrl(request: Request, config: ServerConfig): string {
  if (config.publicServerUrl) {
    return config.publicServerUrl.replace(/\/$/, "");
  }

  const forwardedProto = request.header("x-forwarded-proto");
  const proto = forwardedProto ?? request.protocol;
  const host = request.header("x-forwarded-host") ?? request.header("host") ?? `localhost:${config.port}`;
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function asyncRoute<T>(
  handler: (request: Request, response: import("express").Response) => Promise<T>
) {
  return (request: Request, response: import("express").Response, next: import("express").NextFunction) => {
    handler(request, response).catch(next);
  };
}
