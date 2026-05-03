import { useEffect, useRef, useState } from "react";
import { Play, Power, RotateCcw, SquareTerminal, Zap } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { Project, TerminalServerMessage, TerminalSession } from "@codex-ui/shared";
import type { Connection } from "../types.js";
import { encodeTerminalMessage, terminalUrl } from "../api.js";

type Props = {
  connection: Connection;
  project: Project;
  session: TerminalSession;
  onSessionUpdate(): void;
};

export function TerminalView({ connection, project, session, onSessionUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState(session.status === "exited" ? "已退出" : "连接中");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    setStatus(session.status === "exited" ? "已退出" : "连接中");

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Cascadia Mono, JetBrains Mono, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: "#0c0f14",
        foreground: "#e6edf3",
        cursor: "#79c0ff",
        selectionBackground: "#264f78"
      }
    });
    const fit = new FitAddon();
    const socket = new WebSocket(terminalUrl(connection, project.id, session.id));

    terminalRef.current = terminal;
    fitRef.current = fit;
    socketRef.current = socket;
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.focus();

    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((data) => {
      send({ type: "input", data });
    });

    socket.addEventListener("open", () => {
      setStatus("已连接");
      fitTerminal();
    });

    socket.addEventListener("message", (event) => {
      handleServerMessage(event.data);
    });

    socket.addEventListener("close", () => {
      setStatus((current) => (current === "已退出" ? current : "已断开"));
    });

    socket.addEventListener("error", () => {
      setStatus("错误");
    });

    function handleServerMessage(raw: string) {
      let message: TerminalServerMessage;

      try {
        message = JSON.parse(raw) as TerminalServerMessage;
      } catch {
        terminal.writeln(raw);
        return;
      }

      if (message.type === "ready") {
        setStatus(message.shell);
      } else if (message.type === "output") {
        terminal.write(message.data);
      } else if (message.type === "exit") {
        terminal.writeln("");
        terminal.writeln(`[进程已退出 ${message.code ?? message.signal ?? ""}]`);
        setStatus("已退出");
        onSessionUpdate();
      } else if (message.type === "error") {
        terminal.writeln(message.message);
        setStatus("错误");
      }
    }

    function fitTerminal() {
      try {
        fit.fit();
        send({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows
        });
      } catch {
        // Fit can fail while the container is not yet visible.
      }
    }

    function send(message: Parameters<typeof encodeTerminalMessage>[0]) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodeTerminalMessage(message));
      }
    }

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      socket.close();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [connection.serverUrl, connection.token, project.id, session.id, session.status, nonce, onSessionUpdate]);

  function sendToolbarMessage(message: Parameters<typeof encodeTerminalMessage>[0]) {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(encodeTerminalMessage(message));
    }
  }

  return (
    <section className="terminal-layout workspace-terminal">
      <div className="toolbar terminal-toolbar">
        <div className="section-heading">
          <SquareTerminal size={20} />
          <h2>{session.title}</h2>
        </div>
        <div className="toolbar-actions">
          <span className="terminal-status">{status}</span>
          <button className="icon-button" type="button" title="重新连接" onClick={() => setNonce((value) => value + 1)}>
            <RotateCcw size={18} />
          </button>
          <button className="icon-button" type="button" title="中断当前命令" onClick={() => sendToolbarMessage({ type: "signal", signal: "SIGINT" })}>
            <Power size={18} />
          </button>
          <button className="primary-button compact-button" type="button" onClick={() => sendToolbarMessage({ type: "launchCodex" })}>
            <Zap size={17} />
            <span>启动 Codex</span>
          </button>
          <button className="secondary-button compact-button" type="button" onClick={() => terminalRef.current?.focus()}>
            <Play size={17} />
            <span>聚焦</span>
          </button>
        </div>
      </div>

      <div className="terminal-frame">
        <div ref={containerRef} className="terminal-container" />
      </div>
    </section>
  );
}
