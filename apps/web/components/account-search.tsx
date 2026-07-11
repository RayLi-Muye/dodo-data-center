"use client";

import { accountResolutionResponseSchema, apiErrorSchema } from "@dodo/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ReferenceKind = "account_id" | "steam_id64" | "steam_profile_url";

const options: { kind: ReferenceKind; label: string; placeholder: string }[] = [
  { kind: "account_id", label: "Dota ID", placeholder: "例如 123456789…" },
  { kind: "steam_id64", label: "Steam ID64", placeholder: "17 位 Steam ID64…" },
  { kind: "steam_profile_url", label: "Steam 主页", placeholder: "https://steamcommunity.com/profiles/…" },
];

export function AccountSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<ReferenceKind>("account_id");
  const [value, setValue] = useState(compact ? "" : "123456789");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const active = options.find((option) => option.kind === kind) ?? options[0]!;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const response = await fetch("/api/account-resolutions", {
        body: JSON.stringify({ kind, value: value.trim() }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        setMessage(
          parsedError.success
            ? parsedError.data.error.message
            : "账号暂时无法解析，请检查输入后重试。",
        );
        setStatus("error");
        return;
      }
      const parsed = accountResolutionResponseSchema.safeParse(body);
      if (!parsed.success) {
        setMessage("账号服务返回了无法识别的数据，请稍后重试。");
        setStatus("error");
        return;
      }
      const accountId = parsed.data.data.accountId;
      const syncResponse = await fetch(`/api/players/${encodeURIComponent(accountId)}/sync`, {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      });
      if (!syncResponse.ok) {
        const syncBody: unknown = await syncResponse.json();
        const syncError = apiErrorSchema.safeParse(syncBody);
        setMessage(syncError.success ? syncError.data.error.message : "账号同步未能启动，请稍后重试。");
        setStatus("error");
        return;
      }
      router.push(`/players/${encodeURIComponent(accountId)}`);
    } catch {
      setMessage("无法连接账号服务，请检查网络后重试。");
      setStatus("error");
    }
  }

  return (
    <form className={`account-search${compact ? " account-search--compact" : ""}`} onSubmit={submit}>
      <fieldset>
        <legend>账号类型</legend>
        <div className="segmented-control segmented-control--search">
          {options.map((option) => (
            <label key={option.kind}>
              <input
                checked={kind === option.kind}
                name="account-kind"
                onChange={() => setKind(option.kind)}
                type="radio"
                value={option.kind}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="account-search__input-row">
        <label className="sr-only" htmlFor={compact ? "compact-account-reference" : "account-reference"}>
          {active.label} 账号
        </label>
        <input
          autoComplete="off"
          id={compact ? "compact-account-reference" : "account-reference"}
          inputMode={kind === "steam_profile_url" ? "url" : "numeric"}
          name="account-reference"
          onChange={(event) => setValue(event.target.value)}
          placeholder={active.placeholder}
          required
          spellCheck={false}
          type={kind === "steam_profile_url" ? "url" : "text"}
          value={value}
        />
        <button disabled={status === "loading"} type="submit">
          {status === "loading" ? "正在定位账号…" : "查看比赛数据"}
        </button>
      </div>
      <p className="account-search__hint">仅查询公开比赛历史；不会绕过 Steam 隐私设置。</p>
      <p aria-live="polite" className="account-search__message">
        {status === "error" ? message : ""}
      </p>
    </form>
  );
}
