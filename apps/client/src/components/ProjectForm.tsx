import { FormEvent, useEffect, useState } from "react";
import { FolderOpen, Save, X } from "lucide-react";
import type { Project } from "@codex-ui/shared";

export type ProjectFormValue = {
  name: string;
  path: string;
  defaultShell?: string;
};

type Props = {
  project?: Project;
  busy?: boolean;
  onCancel(): void;
  onSubmit(value: ProjectFormValue): void;
};

export function ProjectForm({ project, busy, onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [defaultShell, setDefaultShell] = useState("");

  useEffect(() => {
    setName(project?.name ?? "");
    setProjectPath(project?.path ?? "");
    setDefaultShell(project?.defaultShell ?? "");
  }, [project]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      path: projectPath,
      defaultShell: defaultShell.trim() || undefined
    });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-panel" onSubmit={submit}>
        <div className="modal-heading">
          <div className="section-heading">
            <FolderOpen size={20} />
            <h2>{project ? "编辑项目" : "添加项目"}</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <label className="field">
          <span>项目名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>本机路径</span>
          <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} autoCapitalize="none" />
        </label>

        <label className="field">
          <span>默认 Shell</span>
          <input
            value={defaultShell}
            onChange={(event) => setDefaultShell(event.target.value)}
            placeholder="留空使用系统默认"
            autoCapitalize="none"
          />
        </label>

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            <X size={17} />
            <span>取消</span>
          </button>
          <button className="primary-button" type="submit" disabled={busy || !name.trim() || !projectPath.trim()}>
            <Save size={17} />
            <span>保存</span>
          </button>
        </div>
      </form>
    </div>
  );
}
