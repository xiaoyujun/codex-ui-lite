import { FormEvent, useEffect, useMemo, useState } from "react";
import { KeyRound, LogIn, Server, UserRound } from "lucide-react";
import type { Connection } from "../types.js";
import { getAuthStatus, login, setupAdmin } from "../api.js";

type Props = {
  onConnected(connection: Connection): void;
};

export function LoginView({ onConnected }: Props) {
  const [serverUrl, setServerUrl] = useState("http://localhost:4177");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(() => {
    if (!serverUrl.trim() || username.trim().length < 3 || password.length < 8) {
      return false;
    }

    return setupRequired ? password === confirmPassword : true;
  }, [confirmPassword, password, serverUrl, setupRequired, username]);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setBusy(true);
    setError("");

    try {
      const status = await getAuthStatus(serverUrl);
      setSetupRequired(status.setupRequired);
    } catch (nextError) {
      setSetupRequired(null);
      setError(nextError instanceof Error ? nextError.message : "无法连接服务端。");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const status = setupRequired === null ? await getAuthStatus(serverUrl) : { setupRequired };
      setSetupRequired(status.setupRequired);

      if (status.setupRequired && password !== confirmPassword) {
        throw new Error("两次输入的密码不一致。");
      }

      const result = status.setupRequired
        ? await setupAdmin(serverUrl, username, password)
        : await login(serverUrl, username, password, deviceName());

      onConnected({
        serverUrl: result.serverUrl,
        token: result.token,
        username: result.username
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "登录失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login-layout">
      <form className="panel login-panel" onSubmit={submit}>
        <div className="section-heading">
          <KeyRound size={20} />
          <h2>{setupRequired ? "首次设置管理员" : "账号密码登录"}</h2>
        </div>

        <label className="field">
          <span>服务地址</span>
          <div className="inline-field">
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} autoCapitalize="none" />
            <button className="icon-button elevated" type="button" title="检查服务" onClick={checkStatus} disabled={busy}>
              <Server size={18} />
            </button>
          </div>
        </label>

        <label className="field">
          <span>用户名</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={setupRequired ? "new-password" : "current-password"}
          />
        </label>

        {setupRequired ? (
          <label className="field">
            <span>确认密码</span>
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </label>
        ) : null}

        <button className="primary-button" type="submit" disabled={busy || !canSubmit}>
          {setupRequired ? <UserRound size={18} /> : <LogIn size={18} />}
          <span>{setupRequired ? "创建管理员并登录" : "登录"}</span>
        </button>

        {setupRequired === null ? <p className="hint-text">请先检查服务状态，或直接输入账号密码登录。</p> : null}
        {setupRequired ? <p className="hint-text">第一次使用需要创建管理员账号，之后手机和网页都用这个账号登录。</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </section>
  );
}

function deviceName(): string {
  return navigator.userAgent.includes("Android") ? "Android 客户端" : "网页客户端";
}
