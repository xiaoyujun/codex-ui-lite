import { useEffect, useRef, useState } from "react";
import { Copy, Eraser, Play, Power, RotateCcw, SquareTerminal, Zap } from "lucide-react";
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
  const outputQueueRef = useRef("");
  const writeFrameRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  const [status, setStatus] = useState(session.status === "exited" ? "已退出" : "连接中");
  const [statusKind, setStatusKind] = useState(session.status === "exited" ? "exited" : "connecting");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    setStatus(session.status === "exited" ? "已退出" : "连接中");
    setStatusKind(session.status === "exited" ? "exited" : "connecting");

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "Cascadia Mono, JetBrains Mono, Consolas, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 8000,
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      scrollSensitivity: 1,
      theme: {
        background: "#090d13",
        foreground: "#d7e1ec",
        cursor: "#61afef",
        cursorAccent: "#090d13",
        selectionBackground: "#294866",
        black: "#090d13",
        red: "#ff6b6b",
        green: "#51cf66",
        yellow: "#ffd43b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#d7e1ec",
        brightBlack: "#5c677a",
        brightRed: "#ff8787",
        brightGreen: "#69db7c",
        brightYellow: "#ffe066",
        brightBlue: "#74b9ff",
        brightMagenta: "#d0a6ea",
        brightCyan: "#66d9e8",
        brightWhite: "#f8fbff"
      }
    });
    const fit = new FitAddon();
    const socket = new WebSocket(terminalUrl(connection, project.id, session.id));

    terminalRef.current = terminal;
    fitRef.current = fit;
    socketRef.current = socket;
    terminal.loadAddon(fit);
    terminal.open(container);
    scheduleFit();
    terminal.focus();

    const resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((data) => {
      terminal.scrollToBottom();
      send({ type: "input", data });
    });

    socket.addEventListener("open", () => {
      setStatus("握手中");
      setStatusKind("connecting");
      scheduleFit();
    });

    socket.addEventListener("message", (event) => {
      handleServerMessage(event.data);
    });

    socket.addEventListener("close", () => {
      setStatus((current) => (current === "已退出" ? current : "已断开"));
      setStatusKind((current) => (current === "exited" ? current : "offline"));
    });

    socket.addEventListener("error", () => {
      setStatus("错误");
      setStatusKind("error");
    });

    function handleServerMessage(raw: string) {
      let message: TerminalServerMessage;

      try {
        message = JSON.parse(raw) as TerminalServerMessage;
      } catch {
        const scrollAnchor = captureScrollAnchor();
        terminal.writeln(raw);
        restoreScrollAnchor(scrollAnchor);
        return;
      }

      if (message.type === "ready") {
        setStatus(shortShellName(message.shell));
        setStatusKind("running");
      } else if (message.type === "output") {
        queueTerminalWrite(message.data);
      } else if (message.type === "exit") {
        flushTerminalWrite();
        const scrollAnchor = captureScrollAnchor();
        terminal.writeln("");
        terminal.writeln(`[进程已退出 ${message.code ?? message.signal ?? ""}]`);
        restoreScrollAnchor(scrollAnchor);
        setStatus("已退出");
        setStatusKind("exited");
        onSessionUpdate();
      } else if (message.type === "error") {
        flushTerminalWrite();
        const scrollAnchor = captureScrollAnchor();
        terminal.writeln(message.message);
        restoreScrollAnchor(scrollAnchor);
        setStatus("错误");
        setStatusKind("error");
      }
    }

    function queueTerminalWrite(data: string) {
      outputQueueRef.current += data;

      if (writeFrameRef.current === null) {
        writeFrameRef.current = window.requestAnimationFrame(() => flushTerminalWrite());
      }
    }

    function flushTerminalWrite() {
      writeFrameRef.current = null;

      if (!outputQueueRef.current) {
        return;
      }

      const data = outputQueueRef.current;
      outputQueueRef.current = "";
      const scrollAnchor = captureScrollAnchor();
      terminal.write(data, () => restoreScrollAnchor(scrollAnchor));
    }

    function scheduleFit() {
      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fitTerminal();
      });
    }

    function fitTerminal() {
      try {
        const scrollAnchor = captureScrollAnchor();
        fit.fit();
        const nextSize = { cols: terminal.cols, rows: terminal.rows };

        if (lastSizeRef.current.cols !== nextSize.cols || lastSizeRef.current.rows !== nextSize.rows) {
          lastSizeRef.current = nextSize;
          send({
            type: "resize",
            cols: nextSize.cols,
            rows: nextSize.rows
          });
        }

        restoreScrollAnchor(scrollAnchor);
      } catch {
        // Fit can fail while the container is not yet visible.
      }
    }

    function send(message: Parameters<typeof encodeTerminalMessage>[0]) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encodeTerminalMessage(message));
      }
    }

    function captureScrollAnchor() {
      const buffer = terminal.buffer.active;

      return {
        followOutput: buffer.baseY - buffer.viewportY <= 1,
        viewportY: buffer.viewportY
      };
    }

    function restoreScrollAnchor(anchor: ReturnType<typeof captureScrollAnchor>) {
      if (anchor.followOutput) {
        terminal.scrollToBottom();
      } else {
        terminal.scrollToLine(anchor.viewportY);
      }
    }

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      if (writeFrameRef.current !== null) {
        window.cancelAnimationFrame(writeFrameRef.current);
      }
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      outputQueueRef.current = "";
      writeFrameRef.current = null;
      resizeFrameRef.current = null;
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

  function clearTerminal() {
    terminalRef.current?.clear();
    terminalRef.current?.scrollToBottom();
    terminalRef.current?.focus();
  }

  function copySelection() {
    const selection = terminalRef.current?.getSelection();

    if (selection) {
      void navigator.clipboard?.writeText(selection).catch(() => undefined);
    }

    terminalRef.current?.focus();
  }

  return (
    <section className="terminal-layout workspace-terminal">
      <div className="toolbar terminal-toolbar">
        <div className="section-heading">
          <SquareTerminal size={20} />
          <h2>{session.title}</h2>
        </div>
        <div className="toolbar-actions">
          <span className={`terminal-status ${statusKind}`}>{status}</span>
          <button className="icon-button" type="button" title="复制选中内容" onClick={copySelection}>
            <Copy size={18} />
          </button>
          <button className="icon-button" type="button" title="清空屏幕" onClick={clearTerminal}>
            <Eraser size={18} />
          </button>
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
        <div className="terminal-chrome">
          <span className="terminal-dots" aria-hidden="true">
            <i className="red" />
            <i className="yellow" />
            <i className="green" />
          </span>
          <span className="terminal-path">{project.path}</span>
        </div>
        <div ref={containerRef} className="terminal-container" />
      </div>
    </section>
  );
}

function shortShellName(shell: string): string {
  const name = shell.split(/[\\/]/).pop();
  return name || shell;
}
